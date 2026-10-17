import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { fetchJobSnapshot, listJobPostings, refreshJobPostings, validateJobRequest } from '../src/job-postings.js';

const env = { SOURCEFOUNDRY_JOBS_ENABLED: '1', SOURCEFOUNDRY_JOB_SOURCES: '["workable:acme"]' };
const workable = { shortcode: 'job-1', title: 'Product Manager', city: 'Bengaluru', country: 'India', description: '<p>Full description</p>', published_on: '2026-10-01' };
const reply = (body: unknown) => new Response(JSON.stringify(body));

describe('public job corpus admission', () => {
  it('requires opt-in, operator credentials, and an allowlisted fixed source', () => {
    expect(() => validateJobRequest('operator', 'workable:acme', {})).toThrow('disabled');
    expect(() => validateJobRequest('agent', 'workable:acme', env)).toThrow('operator');
    expect(() => validateJobRequest('operator', 'workable:other', env)).toThrow('not enabled');
    expect(() => validateJobRequest('operator', 'workable:../../private', env)).toThrow('provider:company');
    expect(validateJobRequest('operator', 'workable:acme', env)).toBe('workable:acme');
  });
});

describe('bounded public ATS connectors', () => {
  it('reads Workable descriptions and dates while generating a trusted job URL', async () => {
    const fetch = vi.fn(async () => reply({ jobs: [{ ...workable, url: 'https://attacker.example' }] }));
    const result = await fetchJobSnapshot('workable:acme', fetch);
    expect(result.complete).toBe(true);
    expect(result.jobs[0]).toMatchObject({ id: 'job-1', location: 'Bengaluru, India', description: workable.description,
      url: 'https://apply.workable.com/j/job-1/', publishedAt: '2026-10-01T00:00:00.000Z' });
    expect(fetch.mock.calls).toHaveLength(1);
  });
  it('fails closed for malformed identities, duplicate results and truncation', async () => {
    expect((await fetchJobSnapshot('workable:acme', async () => reply({ jobs: [{ title: 'oops' }] }))).complete).toBe(false);
    expect((await fetchJobSnapshot('workable:acme', async () => reply({ jobs: [workable, workable] }))).complete).toBe(false);
    const result = await fetchJobSnapshot('workable:acme', async () => reply({ jobs: Array.from({ length: 201 }, (_, i) => ({ ...workable, shortcode: String(i) })) }));
    expect(result.jobs).toHaveLength(200);
    expect(result.complete).toBe(false);
  });
  it('fetches SmartRecruiters details and does not interpret an empty unknown board as removal', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ totalFound: 1, content: [{ id: '123', name: 'PM', company: { name: 'Acme' } }] }))
      .mockResolvedValueOnce(reply({ jobAd: { sections: { description: { text: 'A full description' } } }, location: { city: 'Pune', country: 'India' } }));
    const result = await fetchJobSnapshot('smartrecruiters:Acme', fetch);
    expect(result.complete).toBe(true);
    expect(result.jobs[0]).toMatchObject({ company: 'Acme', location: 'Pune, India', description: 'A full description' });
    expect((await fetchJobSnapshot('smartrecruiters:Acme', async () => reply({ totalFound: 0, content: [] })))).toMatchObject({ complete: false });
  });
  it('returns partial diagnostics for detail/network failure without claiming completeness', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ totalFound: 1, content: [{ id: '123', name: 'PM' }] })).mockRejectedValueOnce(new Error('network unavailable'));
    expect(await fetchJobSnapshot('smartrecruiters:Acme', fetch)).toEqual({ jobs: [], complete: false, error: 'network unavailable' });
  });
});

function database() {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: sql.includes('pg_try_advisory') ? [{ locked: true }] : [] }));
  const release = vi.fn();
  return { query, release, pool: { connect: async () => ({ query, release }), query } as unknown as pg.Pool };
}

describe('atomic snapshot persistence', () => {
  it('never removes jobs on partial/error snapshots and preserves first_seen on conflict', async () => {
    const db = database();
    const snapshot = await fetchJobSnapshot('workable:acme', async () => reply({ jobs: [workable] }));
    await refreshJobPostings(db.pool, 'workable:acme', async () => ({ ...snapshot, complete: false, error: 'partial' }));
    const sql = db.query.mock.calls.map(c => c[0]);
    expect(sql.some(s => s.includes("SET status = 'removed'"))).toBe(false);
    const upsert = sql.find(s => s.includes('INSERT INTO sourcefoundry_job_postings'))!;
    expect(upsert.split('DO UPDATE')[1]).not.toContain('first_seen_at');
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(db.release).toHaveBeenCalledOnce();
  });
  it('only complete snapshots remove missing IDs, with no change to last-seen evidence', async () => {
    const db = database();
    await refreshJobPostings(db.pool, 'workable:acme', async () => ({ jobs: [], complete: true, error: null }));
    const removal = db.query.mock.calls.find(c => c[0].includes("SET status = 'removed'"))!;
    expect(removal[1]).toEqual(['workable:acme', []]);
    expect(removal[0]).not.toContain('last_seen_at =');
  });
  it('rolls back database failure and refuses simultaneous source refresh', async () => {
    const db = database();
    db.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(refreshJobPostings(db.pool, 'workable:acme')).rejects.toThrow('database unavailable');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    const busy = database();
    busy.query.mockResolvedValue({ rows: [] });
    const fetch = vi.fn();
    await expect(refreshJobPostings(busy.pool, 'workable:acme', fetch)).rejects.toThrow('already running');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses never-successful sources and marks bounded reads incomplete', async () => {
    const db = database();
    await expect(listJobPostings(db.pool, 'workable:acme', 200)).rejects.toThrow('no verified');
    await expect(listJobPostings(db.pool, 'workable:acme', 201)).rejects.toThrow('limit');
    const timestamp = '2026-10-17T00:00:00Z';
    const pool = { query: async () => ({ rows: [{ checked_at: timestamp, has_success: true, complete: true,
      jobs: [1, 2].map(id => ({ payload: { id: String(id) }, first_seen_at: timestamp, last_seen_at: timestamp, status: 'open' })) }] }) } as unknown as pg.Pool;
    const result = await listJobPostings(pool, 'workable:acme', 1);
    expect(result.complete).toBe(false);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.firstSeenAt).toBe('2026-10-17T00:00:00.000Z');
  });
});
