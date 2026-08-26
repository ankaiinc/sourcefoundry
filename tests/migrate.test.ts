import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { migrationChecksum, migrationFiles } from '../src/migrate.js';

describe('portable migrations', () => {
  it('discovers only ordered SourceFoundry SQL migrations', async () => {
    await expect(migrationFiles(resolve('migrations'))).resolves.toEqual([
      '001_initial_schema.sql',
      '002_sourcefoundry_agent_credentials.sql',
      '003_source_feeds.sql',
    ]);
  });

  it('uses a stable content checksum to detect edited applied migrations', () => {
    expect(migrationChecksum('select 1;')).toBe(migrationChecksum('select 1;'));
    expect(migrationChecksum('select 1;')).not.toBe(migrationChecksum('select 2;'));
  });
});
