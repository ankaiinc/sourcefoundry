import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('SourceFoundry runtime configuration', () => {
  it('fails closed without database and API credentials', () => {
    expect(() => loadConfig({})).toThrow('SOURCEFOUNDRY_DATABASE_URL is required');
    expect(() => loadConfig(
      { SOURCEFOUNDRY_DATABASE_URL: 'postgres://db' },
      { requireApiToken: true },
    )).toThrow('SOURCEFOUNDRY_API_TOKEN is required');
    expect(loadConfig({ SOURCEFOUNDRY_DATABASE_URL: 'postgres://db' }).apiToken).toBe('');
  });

  it('publishes an immutable release identity supplied by the image', () => {
    expect(loadConfig({
      SOURCEFOUNDRY_DATABASE_URL: 'postgres://db',
      SOURCEFOUNDRY_API_TOKEN: 'token',
      SOURCEFOUNDRY_RELEASE_SHA: 'abc123',
    }).releaseSha).toBe('abc123');
  });

  it('requires an exact release SHA in production', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      SOURCEFOUNDRY_DATABASE_URL: 'postgres://db',
      SOURCEFOUNDRY_RELEASE_SHA: 'unknown',
    })).toThrow(/full 40-character Git SHA/);

    expect(loadConfig({
      NODE_ENV: 'production',
      SOURCEFOUNDRY_DATABASE_URL: 'postgres://db',
      SOURCEFOUNDRY_RELEASE_SHA: 'a'.repeat(40),
    }).releaseSha).toBe('a'.repeat(40));
  });
});
