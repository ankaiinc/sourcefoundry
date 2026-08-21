import { afterEach, describe, expect, it } from 'vitest';
import { fetchDiscoveryEntries } from '../src/ingest/discovery.js';
import type { SignalSource } from '../src/types.js';

const originalExa = process.env.EXA_API_KEY;
const originalSerper = process.env.SERPER_API_KEY;

afterEach(() => {
  if (originalExa === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalExa;
  if (originalSerper === undefined) delete process.env.SERPER_API_KEY;
  else process.env.SERPER_API_KEY = originalSerper;
});

function source(provider: 'exa' | 'serper' | 'github', url: string): SignalSource {
  return {
    id: `source-${provider}`,
    tenantId: 'tenant-1',
    name: `${provider} discovery`,
    sourceType: 'web',
    url,
    enabled: true,
    reliability: 0.9,
    intervalMinutes: 60,
    maxItemsPerFetch: 10,
    timeoutSeconds: 10,
    failureCount: 0,
    metadata: {
      mode: 'discovery', provider, queries: ['AI product evidence'],
      max_results_per_query: 50,
    },
  };
}

describe('typed search-provider adapters', () => {
  it('normalizes Exa results into the provider-neutral SourceEntry contract', async () => {
    process.env.EXA_API_KEY = 'exa-test-key';
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const result = await fetchDiscoveryEntries(
      source('exa', 'https://api.exa.ai/search'),
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: input.toString(), headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ results: [{
          title: 'Evidence changes an AI product launch',
          url: 'https://example.com/launch?utm_source=exa',
          text: 'A product team changed its launch after reviewing operating evidence.',
          author: 'Product Desk',
          publishedDate: '2026-08-20T10:00:00Z',
        }] }), { status: 200 });
      }) as typeof fetch,
      new AbortController().signal,
    );

    expect(calls[0]).toMatchObject({ url: 'https://api.exa.ai/search' });
    expect(calls[0]?.headers.get('x-api-key')).toBe('exa-test-key');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
    expect(calls[0]?.body).toEqual({
      query: 'AI product evidence', type: 'fast', category: 'news', numResults: 10,
      contents: { text: { maxCharacters: 2000 } },
    });
    expect(result.entries[0]).toMatchObject({
      title: 'Evidence changes an AI product launch',
      canonicalUrl: 'https://example.com/launch',
      summary: 'A product team changed its launch after reviewing operating evidence.',
      author: 'Product Desk',
      publishedAt: '2026-08-20T10:00:00.000Z',
      raw: { provider: 'exa', query: 'AI product evidence' },
    });
  });

  it('normalizes Serper news into the same SourceEntry contract without inventing dates', async () => {
    process.env.SERPER_API_KEY = 'serper-test-key';
    const calls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
    const result = await fetchDiscoveryEntries(
      source('serper', 'https://google.serper.dev/news'),
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ news: [{
          title: 'Evidence changes an AI product launch',
          link: 'https://example.com/launch?utm_source=serper',
          snippet: 'A product team changed its launch after reviewing operating evidence.',
          source: 'Product Desk',
          date: '2 hours ago',
        }] }), { status: 200 });
      }) as typeof fetch,
      new AbortController().signal,
    );

    expect(calls[0]?.headers.get('x-api-key')).toBe('serper-test-key');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
    expect(calls[0]?.body).toEqual({ q: 'AI product evidence', num: 10, gl: 'us', hl: 'en' });
    expect(result.entries[0]).toMatchObject({
      title: 'Evidence changes an AI product launch',
      canonicalUrl: 'https://example.com/launch',
      summary: 'A product team changed its launch after reviewing operating evidence.',
      author: 'Product Desk',
      publishedAt: null,
      raw: { provider: 'serper', query: 'AI product evidence' },
    });
  });

  it('discovers fresh public GitHub repositories without requiring a paid key', async () => {
    delete process.env.GITHUB_TOKEN;
    const calls: Array<{ url: URL; headers: Headers }> = [];
    const githubSource = source('github', 'https://api.github.com/search/repositories');
    githubSource.metadata.lookback_days = 21;
    const result = await fetchDiscoveryEntries(
      githubSource,
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: new URL(input.toString()), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ items: [{
          full_name: 'builders/fresh-agent',
          html_url: 'https://github.com/builders/fresh-agent',
          description: 'An agent evaluation toolkit for product teams.',
          stargazers_count: 321,
          language: 'TypeScript',
          created_at: '2026-08-20T10:00:00Z',
          owner: { login: 'builders' },
        }] }), { status: 200 });
      }) as typeof fetch,
      new AbortController().signal,
    );

    expect(calls[0]?.url.pathname).toBe('/search/repositories');
    expect(calls[0]?.url.searchParams.get('q')).toMatch(/^AI product evidence created:>=\d{4}-\d{2}-\d{2}$/);
    expect(calls[0]?.url.searchParams.get('per_page')).toBe('30');
    expect(calls[0]?.headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
    expect(result.entries[0]).toMatchObject({
      title: 'builders/fresh-agent',
      canonicalUrl: 'https://github.com/builders/fresh-agent',
      summary: 'An agent evaluation toolkit for product teams. 321 GitHub stars. Primary language: TypeScript',
      author: 'builders',
      publishedAt: '2026-08-20T10:00:00.000Z',
      raw: { provider: 'github', query: 'AI product evidence' },
    });
  });

  it.each([
    ['exa', 'https://collector.invalid/search', 'EXA_API_KEY', 'exa-test-key', 'Exa key may be sent only'],
    ['serper', 'https://collector.invalid/news', 'SERPER_API_KEY', 'serper-test-key', 'Serper key may be sent only'],
  ] as const)('rejects an unsafe %s destination before fetch', async (provider, url, envName, token, message) => {
    process.env[envName] = token;
    const neverFetch = (() => { throw new Error('fetch must not run'); }) as typeof fetch;
    await expect(fetchDiscoveryEntries(
      source(provider, url), neverFetch, new AbortController().signal,
    )).rejects.toThrow(message);
  });

  it.each([
    ['exa', 'https://api.exa.ai/search', 'Exa discovery source is missing EXA_API_KEY'],
    ['serper', 'https://google.serper.dev/news', 'Serper discovery source is missing SERPER_API_KEY'],
  ] as const)('fails closed when the %s key is absent', async (provider, url, message) => {
    if (provider === 'exa') delete process.env.EXA_API_KEY;
    else delete process.env.SERPER_API_KEY;
    const neverFetch = (() => { throw new Error('fetch must not run'); }) as typeof fetch;
    await expect(fetchDiscoveryEntries(
      source(provider, url), neverFetch, new AbortController().signal,
    )).rejects.toThrow(message);
  });
});
