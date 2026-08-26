import { describe, expect, it } from 'vitest';
import { postgresConnectionOptions } from '../src/postgres.js';

describe('PostgreSQL connection security', () => {
  it('verifies remote server certificates by default', () => {
    expect(postgresConnectionOptions('postgresql://db.example/sourcefoundry')).toEqual({
      connectionString: 'postgresql://db.example/sourcefoundry',
      ssl: { rejectUnauthorized: true },
    });
  });

  it('disables TLS only when the connection string explicitly requests local development mode', () => {
    expect(postgresConnectionOptions('postgresql://localhost/sourcefoundry?sslmode=disable')).toEqual({
      connectionString: 'postgresql://localhost/sourcefoundry?sslmode=disable',
      ssl: false,
    });
  });

  it('prevents connection-string compatibility flags from weakening remote verification', () => {
    expect(postgresConnectionOptions('postgresql://db.example/sourcefoundry?sslmode=no-verify&uselibpqcompat=true')).toEqual({
      connectionString: 'postgresql://db.example/sourcefoundry',
      ssl: { rejectUnauthorized: true },
    });
  });
});
