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

  it('refuses an apply without exact dry-run expectations', async () => {
    const pool = {
      query: () => { throw new Error('database should not be touched'); },
      connect: () => { throw new Error('database should not be touched'); },
    } as unknown as pg.Pool;

    await expect(reconcileActiveJobs(pool, {
      apply: true,
      confirmation: 'cancel-duplicate-active-jobs',
    })).rejects.toThrow('--expect-duplicate-jobs=<dry-run count>');
  });

  it('rolls back before cancellation when locked counts differ from the approval', async () => {
    const statements: string[] = [];
    const summary = { rows: [{ active_jobs: 10, duplicate_jobs: 8, duplicate_groups: 2 }] };
    const client = {
      query: async (sql: string) => {
        statements.push(sql.trim());
        if (sql.includes('WITH grouped AS')) return summary;
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = {
      query: async () => summary,
      connect: async () => client,
    } as unknown as pg.Pool;

    await expect(reconcileActiveJobs(pool, {
      apply: true,
      confirmation: 'cancel-duplicate-active-jobs',
      expectedDuplicateJobs: 7,
      expectedDuplicateGroups: 2,
    })).rejects.toThrow('expected 7, observed 8');

    expect(statements.some((sql) => sql.includes('UPDATE sourcefoundry_jobs AS jobs'))).toBe(false);
    expect(statements).toContain('ROLLBACK');
  });

  it('commits only after cancellation and index postconditions are verified', async () => {
    const statements: string[] = [];
    const before = { rows: [{ active_jobs: 10, duplicate_jobs: 8, duplicate_groups: 2 }] };
    const after = { rows: [{ active_jobs: 2, duplicate_jobs: 0, duplicate_groups: 0 }] };
    let summaryReads = 0;
    const client = {
      query: async (sql: string) => {
        statements.push(sql.trim());
        if (sql.includes('WITH grouped AS')) return summaryReads++ === 0 ? before : after;
        if (sql.includes('UPDATE sourcefoundry_jobs AS jobs')) return { rows: [], rowCount: 8 };
        if (sql.includes('FROM pg_indexes')) return { rows: [{ installed: true }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = {
      query: async () => before,
      connect: async () => client,
    } as unknown as pg.Pool;

    const result = await reconcileActiveJobs(pool, {
      apply: true,
      confirmation: 'cancel-duplicate-active-jobs',
      expectedDuplicateJobs: 8,
      expectedDuplicateGroups: 2,
    });

    expect(result).toMatchObject({
      mode: 'applied',
      activeJobsBefore: 10,
      duplicateJobs: 8,
      duplicateGroups: 2,
      cancelledJobs: 8,
      activeJobsAfter: 2,
      uniqueGuardInstalled: true,
    });
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements).toContain("SET LOCAL lock_timeout = '5s'");
    expect(statements).toContain("SET LOCAL statement_timeout = '15min'");
    expect(statements.find((sql) => sql.includes('UPDATE sourcefoundry_jobs AS jobs'))).not.toContain('RETURNING');
  });
});
