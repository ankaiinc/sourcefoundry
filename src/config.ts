export interface SourceFoundryConfig {
  databaseUrl: string;
  apiToken: string;
  releaseSha: string;
  port: number;
  workerEnabled: boolean;
  workerIntervalMs: number;
  workerConcurrency: number;
  staleJobMinutes: number;
  maxAttempts: number;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireApiToken?: boolean } = {},
): SourceFoundryConfig {
  const databaseUrl = required(env.SOURCEFOUNDRY_DATABASE_URL, 'SOURCEFOUNDRY_DATABASE_URL');
  const apiToken = env.SOURCEFOUNDRY_API_TOKEN?.trim() ?? '';
  if (options.requireApiToken && !apiToken) required(undefined, 'SOURCEFOUNDRY_API_TOKEN');
  const releaseSha = env.SOURCEFOUNDRY_RELEASE_SHA?.trim() || 'development';
  if (env.NODE_ENV === 'production' && !/^[0-9a-f]{40}$/i.test(releaseSha)) {
    throw new Error('SOURCEFOUNDRY_RELEASE_SHA must be the full 40-character Git SHA in production');
  }

  return {
    databaseUrl,
    apiToken,
    releaseSha,
    port: intFromEnv(env.SOURCEFOUNDRY_PORT, 8080),
    workerEnabled: env.SOURCEFOUNDRY_WORKER_ENABLED === '1',
    workerIntervalMs: intFromEnv(env.SOURCEFOUNDRY_WORKER_INTERVAL_MS, 30_000),
    workerConcurrency: intFromEnv(env.SOURCEFOUNDRY_WORKER_CONCURRENCY, 3),
    staleJobMinutes: intFromEnv(env.SOURCEFOUNDRY_STALE_JOB_MINUTES, 30),
    maxAttempts: intFromEnv(env.SOURCEFOUNDRY_MAX_ATTEMPTS, 5),
  };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function intFromEnv(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
