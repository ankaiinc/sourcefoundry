export interface SourceFoundryConfig {
  databaseUrl: string;
  apiToken: string;
  publicBaseUrl: string;
  releaseSha: string;
  port: number;
  workerEnabled: boolean;
  workerIntervalMs: number;
  workerConcurrency: number;
  staleJobMinutes: number;
  maxAttempts: number;
  selfService: {
    enabled: boolean;
    maxSources: number;
    minIntervalMinutes: number;
    maxItemsPerFetch: number;
    maxEnrollmentsPerDay: number;
    maxRunsPerDay: number;
  };
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireApiToken?: boolean } = {},
): SourceFoundryConfig {
  const databaseUrl = required(env.SOURCEFOUNDRY_DATABASE_URL, 'SOURCEFOUNDRY_DATABASE_URL');
  const apiToken = env.SOURCEFOUNDRY_API_TOKEN?.trim() ?? '';
  if (options.requireApiToken && !apiToken) required(undefined, 'SOURCEFOUNDRY_API_TOKEN');
  const port = intFromEnv(env.SOURCEFOUNDRY_PORT, 8080);
  const releaseSha = env.SOURCEFOUNDRY_RELEASE_SHA?.trim() || 'development';
  if (env.NODE_ENV === 'production' && !/^[0-9a-f]{40}$/i.test(releaseSha)) {
    throw new Error('SOURCEFOUNDRY_RELEASE_SHA must be the full 40-character Git SHA in production');
  }
  const publicBaseUrl = publicBaseUrlFromEnv(env, port);

  return {
    databaseUrl,
    apiToken,
    publicBaseUrl,
    releaseSha,
    port,
    workerEnabled: env.SOURCEFOUNDRY_WORKER_ENABLED === '1',
    workerIntervalMs: intFromEnv(env.SOURCEFOUNDRY_WORKER_INTERVAL_MS, 30_000),
    workerConcurrency: intFromEnv(env.SOURCEFOUNDRY_WORKER_CONCURRENCY, 3),
    staleJobMinutes: intFromEnv(env.SOURCEFOUNDRY_STALE_JOB_MINUTES, 30),
    maxAttempts: intFromEnv(env.SOURCEFOUNDRY_MAX_ATTEMPTS, 5),
    selfService: {
      enabled: env.SOURCEFOUNDRY_SELF_SERVICE_ENABLED === '1',
      maxSources: intFromEnv(env.SOURCEFOUNDRY_SELF_SERVICE_MAX_SOURCES, 3),
      minIntervalMinutes: intFromEnv(env.SOURCEFOUNDRY_SELF_SERVICE_MIN_INTERVAL_MINUTES, 720),
      maxItemsPerFetch: intFromEnv(env.SOURCEFOUNDRY_SELF_SERVICE_MAX_ITEMS_PER_FETCH, 10),
      maxEnrollmentsPerDay: intFromEnv(env.SOURCEFOUNDRY_SELF_SERVICE_MAX_ENROLLMENTS_PER_DAY, 50),
      maxRunsPerDay: intFromEnv(env.SOURCEFOUNDRY_SELF_SERVICE_MAX_RUNS_PER_DAY, 24),
    },
  };
}

function publicBaseUrlFromEnv(env: NodeJS.ProcessEnv, port: number): string {
  const configured = env.SOURCEFOUNDRY_PUBLIC_BASE_URL?.trim();
  if (env.NODE_ENV === 'production' && !configured) {
    throw new Error('SOURCEFOUNDRY_PUBLIC_BASE_URL is required in production');
  }
  const value = configured || `http://localhost:${port}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SOURCEFOUNDRY_PUBLIC_BASE_URL must be an absolute URL');
  }
  if (parsed.username || parsed.password || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('SOURCEFOUNDRY_PUBLIC_BASE_URL must be an http(s) URL without credentials');
  }
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('SOURCEFOUNDRY_PUBLIC_BASE_URL must use HTTPS in production');
  }
  return parsed.toString().replace(/\/$/, '');
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
