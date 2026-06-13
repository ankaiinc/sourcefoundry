import { loadConfig } from './config.js';
import { workerTick, withHeartbeat } from './pipeline.js';
import { PostgresSourceFoundryRepository } from './postgres-repository.js';

const config = loadConfig();

if (!config.workerEnabled) {
  console.log('sourcefoundry worker disabled by SOURCEFOUNDRY_WORKER_ENABLED');
  process.exit(0);
}

const repo = new PostgresSourceFoundryRepository(config.databaseUrl);
let running = false;

async function run(): Promise<void> {
  if (running) {
    console.log('sourcefoundry worker skip: previous tick still running');
    return;
  }

  running = true;
  try {
    const result = await withHeartbeat(repo, 'signal-worker', () =>
      workerTick(repo, {
        maxDueSources: config.workerConcurrency,
        maxAttempts: config.maxAttempts,
        staleJobMinutes: config.staleJobMinutes,
      }),
    );
    console.log('sourcefoundry worker tick ok', result);
  } catch (error) {
    console.error('sourcefoundry worker tick failed', error);
  } finally {
    running = false;
  }
}

setInterval(() => {
  void run();
}, config.workerIntervalMs);

void run();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
