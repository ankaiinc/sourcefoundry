import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { postgresConnectionOptions } from './postgres.js';

const { Pool } = pg;

export async function migrationFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export async function runMigrations(options: {
  databaseUrl: string;
  directory?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ applied: string[]; skipped: string[] }> {
  const directory = options.directory ?? resolve(fileURLToPath(new URL('../../migrations', import.meta.url)));
  const pool = new Pool({ ...postgresConnectionOptions(options.databaseUrl, options.env), max: 1 });
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('sourcefoundry:migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.sourcefoundry_schema_migrations (
        filename text PRIMARY KEY,
        checksum text,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('ALTER TABLE public.sourcefoundry_schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    await client.query('ALTER TABLE public.sourcefoundry_schema_migrations ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON TABLE public.sourcefoundry_schema_migrations FROM PUBLIC');
    const completed = await client.query<{ filename: string; checksum: string | null }>('SELECT filename, checksum FROM public.sourcefoundry_schema_migrations');
    const completedFiles = new Map(completed.rows.map((row) => [row.filename, row.checksum]));

    for (const filename of await migrationFiles(directory)) {
      const sql = await readFile(resolve(directory, filename), 'utf8');
      const checksum = migrationChecksum(sql);
      if (completedFiles.has(filename)) {
        const recordedChecksum = completedFiles.get(filename);
        if (recordedChecksum && recordedChecksum !== checksum) {
          throw new Error(`applied migration ${filename} has changed; create a new migration instead`);
        }
        if (!recordedChecksum) {
          await client.query('UPDATE public.sourcefoundry_schema_migrations SET checksum = $2 WHERE filename = $1', [filename, checksum]);
        }
        skipped.push(filename);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.sourcefoundry_schema_migrations (filename, checksum) VALUES ($1, $2)', [filename, checksum]);
        await client.query('COMMIT');
        applied.push(filename);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('sourcefoundry:migrations'))").catch(() => undefined);
    client.release();
    await pool.end();
  }
  return { applied, skipped };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.SOURCEFOUNDRY_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('SOURCEFOUNDRY_DATABASE_URL is required');
  const result = await runMigrations({ databaseUrl });
  console.log(`sourcefoundry migrations applied=${result.applied.length} skipped=${result.skipped.length}`);
  for (const filename of result.applied) console.log(`applied ${filename}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error('sourcefoundry migration failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
