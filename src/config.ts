export interface SourceFoundryConfig {
  databaseUrl: string;
  apiToken: string;
  port: number;
  workerEnabled: boolean;
  workerIntervalMs: number;
  workerConcurrency: number;
  staleJobMinutes: number;
  maxAttempts: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SourceFoundryConfig {
  const databaseUrl = required(env.SOURCEFOUNDRY_DATABASE_URL, 'SOURCEFOUNDRY_DATABASE_URL');

  return {
    databaseUrl,
    apiToken: env.SOURCEFOUNDRY_API_TOKEN ?? '',
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
