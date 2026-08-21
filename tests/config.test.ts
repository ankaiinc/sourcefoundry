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

  it('uses conservative autonomous-workspace defaults', () => {
    expect(loadConfig({ SOURCEFOUNDRY_DATABASE_URL: 'postgres://db' }).selfService).toEqual({
      enabled: false,
      maxSources: 3,
      minIntervalMinutes: 720,
      maxItemsPerFetch: 10,
      maxEnrollmentsPerDay: 50,
      maxRunsPerTenantPerDay: 6,
      maxRunsTotalPerDay: 24,
    });
  });

  it('publishes an HTTPS canonical endpoint in production', () => {
    expect(loadConfig({
      NODE_ENV: 'production',
      SOURCEFOUNDRY_DATABASE_URL: 'postgres://db',
      SOURCEFOUNDRY_RELEASE_SHA: 'a'.repeat(40),
      SOURCEFOUNDRY_PUBLIC_BASE_URL: 'https://sources.4agents.fyi/',
    }).publicBaseUrl).toBe('https://sources.4agents.fyi');

    expect(() => loadConfig({
      NODE_ENV: 'production',
      SOURCEFOUNDRY_DATABASE_URL: 'postgres://db',
      SOURCEFOUNDRY_RELEASE_SHA: 'a'.repeat(40),
      SOURCEFOUNDRY_PUBLIC_BASE_URL: 'http://sources.4agents.fyi',
    })).toThrow('must use HTTPS');
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
      SOURCEFOUNDRY_PUBLIC_BASE_URL: 'https://sources.4agents.fyi',
    }).releaseSha).toBe('a'.repeat(40));
  });
});
