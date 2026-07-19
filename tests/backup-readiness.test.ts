import { describe, expect, it } from 'vitest';
import { verifySupabaseBackupReadiness } from '../src/backup-readiness.js';

function backupFetch(body: Record<string, unknown>, capture?: { method?: string; authorization?: string }): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (capture) {
      if (init?.method) capture.method = init.method;
      const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (authorization) capture.authorization = authorization;
    }
    return Response.json(body);
  }) as typeof fetch;
}

const PROJECT_REF = 'vwdiudevdhhcdknmoupb';
const NOW = new Date('2026-07-19T12:00:00.000Z');

describe('Supabase hosted backup readiness', () => {
  it('accepts a fresh completed daily backup through a GET-only request', async () => {
    const capture: { method?: string; authorization?: string } = {};
    const report = await verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: 'secret-backup-token',
      now: NOW,
      fetchImpl: backupFetch({
        region: 'ap-southeast-2',
        walg_enabled: true,
        pitr_enabled: false,
        backups: [{ id: 42, status: 'COMPLETED', inserted_at: '2026-07-19T03:00:00.000Z' }],
      }, capture),
    });

    expect(report.recoverable).toBe(true);
    expect(report.latestRestorePointAgeHours).toBe(9);
    expect(report.completedBackups).toBe(1);
    expect(report.requestMethod).toBe('GET');
    expect(report.mutationRequests).toBe(0);
    expect(capture.method).toBe('GET');
    expect(capture.authorization).toBe('Bearer secret-backup-token');
    expect(JSON.stringify(report)).not.toContain('secret-backup-token');
  });

  it('accepts a fresh physical restore point even when no downloadable backup exists', async () => {
    const report = await verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: 'secret',
      now: NOW,
      fetchImpl: backupFetch({
        pitr_enabled: true,
        walg_enabled: true,
        backups: [],
        physical_backup_data: {
          earliest_physical_backup_date_unix: 1784329200,
          latest_physical_backup_date_unix: 1784461200,
        },
      }),
    });

    expect(report.recoverable).toBe(true);
    expect(report.pitrEnabled).toBe(true);
    expect(report.latestRestorePointAt).toBe('2026-07-19T11:40:00.000Z');
  });

  it('fails closed when the newest restore point is stale', async () => {
    const report = await verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: 'secret',
      now: NOW,
      maximumAgeHours: 24,
      fetchImpl: backupFetch({
        backups: [{ status: 'COMPLETED', inserted_at: '2026-07-17T00:00:00.000Z' }],
      }),
    });

    expect(report.recoverable).toBe(false);
    expect(report.reason).toContain('beyond the 24-hour gate');
  });

  it('fails closed when no completed backup or physical restore point is returned', async () => {
    const report = await verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: 'secret',
      now: NOW,
      fetchImpl: backupFetch({ backups: [{ status: 'FAILED', inserted_at: '2026-07-19T11:00:00.000Z' }] }),
    });

    expect(report.recoverable).toBe(false);
    expect(report.latestRestorePointAt).toBeNull();
  });

  it('fails closed on an implausibly future-dated restore point', async () => {
    const report = await verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: 'secret',
      now: NOW,
      fetchImpl: backupFetch({
        backups: [{ status: 'COMPLETED', inserted_at: '2026-07-20T12:00:00.000Z' }],
      }),
    });

    expect(report.recoverable).toBe(false);
    expect(report.reason).toContain('inspection clock');
  });

  it('reports authentication failures without exposing response or token content', async () => {
    const fetchImpl = (async (): Promise<Response> => new Response('token secret-token invalid', { status: 403 })) as typeof fetch;
    await expect(verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: 'secret-token',
      fetchImpl,
    })).rejects.toThrow('HTTP 403');
  });

  it('redacts the credential from network-layer errors', async () => {
    const fetchImpl = (async (): Promise<Response> => {
      throw new Error('request failed for secret-token');
    }) as typeof fetch;
    await expect(verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: 'secret-token',
      fetchImpl,
    })).rejects.toThrow('request failed for [redacted]');
  });

  it('rejects invalid project, credential, and freshness inputs before fetching', async () => {
    await expect(verifySupabaseBackupReadiness({
      projectRef: 'wrong',
      accessToken: 'secret',
      fetchImpl: backupFetch({}),
    })).rejects.toThrow('20-character');
    await expect(verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: '',
      fetchImpl: backupFetch({}),
    })).rejects.toThrow('SUPABASE_ACCESS_TOKEN');
    await expect(verifySupabaseBackupReadiness({
      projectRef: PROJECT_REF,
      accessToken: 'secret',
      maximumAgeHours: 0,
      fetchImpl: backupFetch({}),
    })).rejects.toThrow('maximumAgeHours');
  });
});
