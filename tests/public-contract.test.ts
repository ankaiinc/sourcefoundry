import { describe, expect, it } from 'vitest';
import { listSourceFoundrySignals, SourceFoundryHttpError, SourceFoundryTransportError } from '../src/client.js';
import { parsePublicSignalsResponse, SourceFoundryContractError } from '../src/public-contract.js';
import type { PublicSignal, PublicSignalsResponse } from '../src/types.js';

function signal(): PublicSignal {
  return {
    schemaVersion: 1,
    id: 'candidate-1',
    tenantId: 'tenant-1',
    title: 'A typed signal',
    summary: 'A provider-neutral summary.',
    url: 'https://example.com/signal',
    status: 'published',
    score: 0.9,
    tags: ['product'],
    generatedAt: '2026-08-21T10:00:00.000Z',
    publishedAt: '2026-08-21T09:00:00.000Z',
    source: { id: 'source-1', name: 'Example', type: 'web', provider: 'exa', reliability: 0.9 },
    provenance: {
      sourceItemId: 'item-1', canonicalUrl: 'https://example.com/signal',
      fetchedAt: '2026-08-21T10:00:00.000Z', contentHash: 'hash', author: 'Reporter', query: 'product evidence',
    },
    freshness: {
      publishedAt: '2026-08-21T09:00:00.000Z', fetchedAt: '2026-08-21T10:00:00.000Z', ageSeconds: 3600,
    },
    completeness: { title: true, summary: true, author: true, publishedAt: true },
    failureState: { state: 'healthy', consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null },
    aggregation: { signalKey: 'signal-key', observationCount: 1, sourceCount: 1, capped: false },
    observations: [],
  };
}

function response(): PublicSignalsResponse {
  return { schemaVersion: 1, release: 'abc123', signals: [signal()] };
}

describe('SourceFoundry public contract', () => {
  it('accepts a complete provider-neutral signal response', () => {
    expect(parsePublicSignalsResponse(response())).toEqual(response());
  });

  it('rejects incompatible versions and incomplete signals', () => {
    expect(() => parsePublicSignalsResponse({ ...response(), schemaVersion: 2 })).toThrow(SourceFoundryContractError);
    const invalid = response() as unknown as { schemaVersion: 1; release: string; signals: Array<Record<string, unknown>> };
    invalid.signals[0] = { ...invalid.signals[0], aggregation: undefined };
    expect(() => parsePublicSignalsResponse(invalid)).toThrow('signals[0].aggregation');

    const invalidStatus = response() as unknown as { signals: Array<Record<string, unknown>> };
    invalidStatus.signals[0] = { ...invalidStatus.signals[0], status: 'ready' };
    expect(() => parsePublicSignalsResponse(invalidStatus)).toThrow('status is invalid');
  });

  it('uses the typed client boundary and sends tenant filters', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const result = await listSourceFoundrySignals({
      baseUrl: 'https://sourcefoundry.test',
      token: 'token',
      tenant: 'pragmatic-leaders',
      statuses: ['published', 'approved'],
      limit: 500,
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: input.toString(), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify(response()), { status: 200 });
      }) as typeof fetch,
    });

    expect(calls[0]?.url).toBe('https://sourcefoundry.test/v1/signals?tenant=pragmatic-leaders&statuses=published%2Capproved&limit=100');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer token');
    expect(result.signals[0]?.source.provider).toBe('exa');
  });

  it('surfaces typed upstream errors instead of returning an empty result', async () => {
    const request = listSourceFoundrySignals({
      baseUrl: 'https://sourcefoundry.test', token: 'token', tenant: 'pragmatic-leaders',
      fetchFn: (async () => new Response(JSON.stringify({
        schemaVersion: 1, release: 'abc123',
        error: { code: 'not_ready', message: 'Database is not ready', retryable: true },
      }), { status: 503 })) as typeof fetch,
    });
    await expect(request).rejects.toMatchObject({
      name: 'SourceFoundryHttpError', status: 503, retryable: true, code: 'not_ready', message: 'Database is not ready',
    } satisfies Partial<SourceFoundryHttpError>);
  });

  it('distinguishes invalid payloads from transport failures', async () => {
    await expect(listSourceFoundrySignals({
      baseUrl: 'https://sourcefoundry.test', token: 'token', tenant: 'pragmatic-leaders',
      fetchFn: (async () => new Response('not-json', { status: 200 })) as typeof fetch,
    })).rejects.toThrow('invalid JSON');

    await expect(listSourceFoundrySignals({
      baseUrl: 'https://sourcefoundry.test', token: 'token', tenant: 'pragmatic-leaders',
      fetchFn: (async () => { throw new Error('network unavailable'); }) as typeof fetch,
    })).rejects.toBeInstanceOf(SourceFoundryTransportError);
  });

  it('rejects unsafe URLs and impossible confidence values', () => {
    const unsafe = response();
    unsafe.signals[0]!.url = 'javascript:alert(1)';
    expect(() => parsePublicSignalsResponse(unsafe)).toThrow('signals[0].url');

    const impossible = response();
    impossible.signals[0]!.score = 2;
    expect(() => parsePublicSignalsResponse(impossible)).toThrow('score must be between 0 and 1');
  });

  it('requires explicit tenant identity before any request', async () => {
    await expect(listSourceFoundrySignals({
      baseUrl: 'https://sourcefoundry.test', token: 'token',
    })).rejects.toThrow('tenant or tenantId is required');
  });
});
