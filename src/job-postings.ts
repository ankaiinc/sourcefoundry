import type pg from 'pg';
import { safeFetch } from './safe-fetch.js';

export interface JobPosting {
  id: string; url: string; title: string; company: string; location: string | null;
  description: string | null; publishedAt: string | null;
  firstSeenAt: string; lastSeenAt: string; status: 'open' | 'removed';
}
type IncomingJob = Omit<JobPosting, 'firstSeenAt' | 'lastSeenAt' | 'status'>;
export interface JobSnapshot { jobs: IncomingJob[]; complete: boolean; error: string | null }
export class JobPostingError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function validateJobRequest(kind: string, source: unknown, env = process.env): string {
  if (env.SOURCEFOUNDRY_JOBS_ENABLED !== '1') throw new JobPostingError(404, 'Job corpus is disabled');
  if (kind !== 'operator') throw new JobPostingError(403, 'Job corpus requires operator access');
  if (typeof source !== 'string' || !/^(smartrecruiters|workable):[a-zA-Z0-9_-]{1,100}$/.test(source)) {
    throw new JobPostingError(400, 'Expected supported provider:company source');
  }
  let allowed: unknown;
  try { allowed = JSON.parse(env.SOURCEFOUNDRY_JOB_SOURCES ?? '[]'); } catch { throw new JobPostingError(503, 'Invalid job source configuration'); }
  if (!Array.isArray(allowed) || !allowed.every(s => typeof s === 'string')) throw new JobPostingError(503, 'Invalid job source configuration');
  if (!allowed.includes(source)) throw new JobPostingError(403, 'Job source is not enabled');
  return source;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed provider object');
  return value as Record<string, unknown>;
}
function required(value: unknown, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Malformed provider identity');
  return value;
}
function optional(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null; }
function description(value: unknown): string | null {
  if (value != null && typeof value !== 'string') throw new Error('Malformed provider description');
  const text = optional(value);
  if (text && text.length > 40_000) throw new Error('Provider description exceeds 40000 characters');
  return text;
}
function date(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Malformed provider date');
  return new Date(value).toISOString();
}
function location(value: unknown): string | null {
  if (value == null) return null;
  const l = object(value);
  return optional(l.fullLocation) ?? ([l.city, l.region ?? l.state, l.country].map(optional).filter(Boolean).join(', ') || null);
}

export async function fetchJobSnapshot(source: string, fetcher: typeof safeFetch = safeFetch): Promise<JobSnapshot> {
  if (!/^(smartrecruiters|workable):[a-zA-Z0-9_-]{1,100}$/.test(source)) throw new Error('Invalid source');
  const [provider, slug] = source.split(':') as [string, string];
  const jobs: IncomingJob[] = [];
  const signal = AbortSignal.timeout(45_000);
  const json = async (url: string) => {
    const response = await fetcher(url, { signal, headers: { accept: 'application/json', 'user-agent': 'SourceFoundry/0.1' } });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    return object(await response.json());
  };
  try {
    if (provider === 'workable') {
      const body = await json(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`);
      if (!Array.isArray(body.jobs)) throw new Error('Malformed provider jobs');
      for (const raw of body.jobs.slice(0, 200)) {
        const j = object(raw), id = required(j.shortcode, 200);
        const locations = Array.isArray(j.locations) ? j.locations.map(object).filter(l => l.hidden !== true).map(location).filter(Boolean).join('; ') : '';
        jobs.push({ id, url: `https://apply.workable.com/j/${encodeURIComponent(id)}/`, title: required(j.title), company: slug,
          location: locations || location(j), description: description(j.description), publishedAt: date(j.published_on) });
      }
      return { jobs, complete: body.jobs.length <= 200 && new Set(jobs.map(j => j.id)).size === jobs.length, error: null };
    }
    const base = `https://api.smartrecruiters.com/v1/companies/${slug}/postings`;
    let total = -1;
    for (let offset = 0; offset < 200; offset += 100) {
      const page = await json(`${base}?limit=100&offset=${offset}`);
      if (!Array.isArray(page.content) || !Number.isInteger(page.totalFound) || Number(page.totalFound) < 0 || page.content.length > 100) throw new Error('Malformed provider page');
      if (total !== -1 && total !== page.totalFound) throw new Error('Provider changed during pagination');
      total = Number(page.totalFound);
      // shortcut: zero SmartRecruiters results can mean a mistyped company; keep removals unconfirmed until a provider identity check exists.
      if (total === 0) return { jobs, complete: false, error: 'Empty board identity is unconfirmed' };
      for (const raw of page.content) {
        const j = object(raw), id = required(j.id, 200);
        const detail = await json(`${base}/${encodeURIComponent(id)}`);
        const sections = object(object(detail.jobAd).sections);
        const content = description(Object.values(sections).map(section => optional(object(section).text)).filter(Boolean).join('\n')); 
        jobs.push({ id, url: `https://jobs.smartrecruiters.com/${slug}/${encodeURIComponent(id)}`, title: required(j.name),
          company: j.company ? required(object(j.company).name, 300) : slug, location: location(detail.location ?? j.location),
          description: content, publishedAt: date(detail.releasedDate ?? j.releasedDate) });
      }
      if (offset + page.content.length >= total) break;
      if (page.content.length !== 100) throw new Error('Incomplete provider page');
    }
    return { jobs, complete: jobs.length === total && new Set(jobs.map(j => j.id)).size === jobs.length, error: null };
  } catch (error) {
    return { jobs, complete: false, error: error instanceof Error ? error.message : 'Provider failed' };
  }
}

export async function refreshJobPostings(pool: pg.Pool, source: string, fetcher: typeof fetchJobSnapshot = fetchJobSnapshot) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`job-postings:${source}`]);
    if (!lock.rows[0]?.locked) throw new JobPostingError(409, 'Source refresh already running');
    const snapshot = await fetcher(source);
    const checkedAt = new Date().toISOString();
    for (const job of snapshot.jobs) {
      await client.query(`INSERT INTO sourcefoundry_job_postings (source, id, payload, first_seen_at, last_seen_at, status)
        VALUES ($1, $2, $3, $4, $4, 'open') ON CONFLICT (source, id) DO UPDATE
        SET payload = EXCLUDED.payload, last_seen_at = EXCLUDED.last_seen_at, status = 'open'`, [source, job.id, job, checkedAt]);
    }
    if (snapshot.complete) {
      await client.query("UPDATE sourcefoundry_job_postings SET status = 'removed' WHERE source = $1 AND NOT (id = ANY($2::text[]))", [source, snapshot.jobs.map(j => j.id)]);
    }
    await client.query(`INSERT INTO sourcefoundry_job_source_status (source, checked_at, complete, error, has_success)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source) DO UPDATE SET checked_at = EXCLUDED.checked_at,
      complete = EXCLUDED.complete, error = EXCLUDED.error, has_success = sourcefoundry_job_source_status.has_success OR EXCLUDED.has_success`,
    [source, checkedAt, snapshot.complete, snapshot.error, snapshot.complete || snapshot.jobs.length > 0]);
    await client.query('COMMIT');
    return { source, checkedAt, complete: snapshot.complete, count: snapshot.jobs.length, error: snapshot.error };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function listJobPostings(pool: pg.Pool, source: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new JobPostingError(400, 'limit must be an integer from 1 to 200');
  const result = await pool.query(`SELECT s.checked_at, s.complete, s.has_success,
    (SELECT coalesce(jsonb_agg(j), '[]') FROM (SELECT payload, first_seen_at, last_seen_at, status FROM sourcefoundry_job_postings
      WHERE source = s.source ORDER BY (status = 'open') DESC, last_seen_at DESC, id LIMIT $2) j) AS jobs FROM sourcefoundry_job_source_status s WHERE source = $1`, [source, limit + 1]);
  const state = result.rows[0];
  if (!state?.has_success) throw new JobPostingError(503, 'Source has no verified observations');
  const jobs = state.jobs as Array<{ payload: IncomingJob; first_seen_at: string; last_seen_at: string; status: JobPosting['status'] }>;
  return { source, checkedAt: new Date(state.checked_at).toISOString(), complete: state.complete && jobs.length <= limit,
    jobs: jobs.slice(0, limit).map(j => ({ ...j.payload, firstSeenAt: new Date(j.first_seen_at).toISOString(), lastSeenAt: new Date(j.last_seen_at).toISOString(), status: j.status })) };
}
