import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

export function postgresConnectionOptions(
  databaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Pick<PoolConfig, 'connectionString' | 'ssl'> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('SOURCEFOUNDRY_DATABASE_URL must be a PostgreSQL URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('SOURCEFOUNDRY_DATABASE_URL must use postgres:// or postgresql://');
  }
  if (url.searchParams.get('sslmode') === 'disable') {
    return { connectionString: databaseUrl, ssl: false };
  }

  // node-postgres lets SSL query parameters override the explicit ssl object.
  // Remove them so certificate verification and an operator-provided CA cannot
  // be weakened by sslmode=require/no-verify compatibility behavior.
  for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) {
    url.searchParams.delete(parameter);
  }
  const caFile = env.SOURCEFOUNDRY_DATABASE_CA_FILE?.trim();
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}),
    },
  };
}
