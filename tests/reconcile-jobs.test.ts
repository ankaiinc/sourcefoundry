import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { reconcileActiveJobs } from '../src/reconcile-jobs.js';

describe('active job reconciliation guard', () => {
  it('refuses an apply without the exact destructive confirmation', async () => {
    const pool = {
      query: () => { throw new Error('database should not be touched'); },
      connect: () => { throw new Error('database should not be touched'); },
    } as unknown as pg.Pool;

    await expect(reconcileActiveJobs(pool, { apply: true })).rejects.toThrow(
      '--confirm=cancel-duplicate-active-jobs',
    );
  });
});
