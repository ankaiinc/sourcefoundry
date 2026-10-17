import { readFileSync } from 'node:fs';
import pg from 'pg';
import { expect, it } from 'vitest';
import { refreshJobPostings, listJobPostings } from '../src/job-postings.js';

// Explicit isolated test URL only; never consume application database credentials.
it.skipIf(!process.env.JOB_POSTINGS_TEST_DATABASE_URL)('preserves evidence and commits removals atomically in PostgreSQL', async () => {
  const pool = new pg.Pool({ connectionString: process.env.JOB_POSTINGS_TEST_DATABASE_URL });
  try {
    await pool.query(readFileSync(new URL('../migrations/004_job_postings.sql', import.meta.url), 'utf8'));
    const job = { id: 'workable:acme:1', url: 'https://apply.workable.com/j/1/', title: 'PM', company: 'acme', location: 'India', description: 'Full description', publishedAt: '2026-10-01T00:00:00Z' };
    await refreshJobPostings(pool, 'workable:acme', async () => ({ jobs: [job], complete: true, error: null }));
    const initial = (await listJobPostings(pool, 'workable:acme', 200)).jobs[0]!;
    await refreshJobPostings(pool, 'workable:acme', async () => ({ jobs: [], complete: false, error: 'provider failure' }));
    const failed = await listJobPostings(pool, 'workable:acme', 200);
    expect(failed.complete).toBe(false);
    expect(failed.jobs[0]).toEqual(initial);
    await refreshJobPostings(pool, 'workable:acme', async () => ({ jobs: [], complete: true, error: null }));
    expect((await listJobPostings(pool, 'workable:acme', 200)).jobs[0]).toEqual({ ...initial, status: 'removed' });
    await refreshJobPostings(pool, 'workable:acme', async () => ({ jobs: [{ ...job, title: 'Senior PM' }], complete: true, error: null }));
    const restored = (await listJobPostings(pool, 'workable:acme', 200)).jobs[0]!;
    expect(restored.firstSeenAt).toBe(initial.firstSeenAt);
    expect(restored.status).toBe('open');
    expect(restored.title).toBe('Senior PM');
    expect(restored.publishedAt).toBe(job.publishedAt);
  } finally { await pool.end(); }
});
