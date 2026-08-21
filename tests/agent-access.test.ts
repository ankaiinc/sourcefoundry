import { describe, expect, it } from 'vitest';
import { createAgentToken, startOfUtcDay, tokenHash, tokenPrefix, validateAgentSourcePolicy } from '../src/agent-access.js';

describe('autonomous agent access', () => {
  const policy = { minIntervalMinutes: 720, maxItemsPerFetch: 10 };

  it('creates opaque secrets and retains only a stable hash and prefix', () => {
    const token = createAgentToken();
    expect(token).toMatch(/^sfa_[A-Za-z0-9_-]{43}$/);
    expect(tokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenPrefix(token)).toBe(token.slice(0, 12));
  });

  it('sets daily enrollment windows in UTC', () => {
    expect(startOfUtcDay(new Date('2026-08-21T19:30:00+05:30')).toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });

  it('rejects autonomous sources that could bypass cost and network boundaries', () => {
    expect(() => validateAgentSourcePolicy({ sourceType: 'rss', url: 'https://127.0.0.1/feed', intervalMinutes: 720, maxItemsPerFetch: 10, metadata: {} }, policy)).toThrow('private network');
    expect(() => validateAgentSourcePolicy({ sourceType: 'rss', url: 'https://[::1]/feed', intervalMinutes: 720, maxItemsPerFetch: 10, metadata: {} }, policy)).toThrow('private network');
    expect(() => validateAgentSourcePolicy({ sourceType: 'rss', url: 'https://[fd00::1]/feed', intervalMinutes: 720, maxItemsPerFetch: 10, metadata: {} }, policy)).toThrow('private network');
    expect(() => validateAgentSourcePolicy({ sourceType: 'web', url: 'https://api.tavily.com/search', intervalMinutes: 60, maxItemsPerFetch: 10, metadata: { provider: 'tavily' } }, policy)).toThrow('at least 720');
    expect(() => validateAgentSourcePolicy({ sourceType: 'web', url: 'https://api.tavily.com/search', intervalMinutes: 720, maxItemsPerFetch: 10, metadata: { provider: 'tavily', api_key: 'nope' } }, policy)).toThrow('credentials');
  });
});
