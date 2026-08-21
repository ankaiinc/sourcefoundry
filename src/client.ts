import { parsePublicSignalsResponse, SourceFoundryContractError } from './public-contract.js';
import type { PublicSignalsResponse, PublicSignalStatus } from './types.js';

export class SourceFoundryHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SourceFoundryHttpError';
  }
}

export class SourceFoundryTransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SourceFoundryTransportError';
  }
}

export interface ListSignalsOptions {
  baseUrl: string;
  token: string;
  tenant?: string;
  tenantId?: string;
  statuses?: PublicSignalStatus[];
  limit?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export async function listSourceFoundrySignals(options: ListSignalsOptions): Promise<PublicSignalsResponse> {
  if (!options.tenant && !options.tenantId) {
    throw new SourceFoundryContractError('A tenant or tenantId is required');
  }
  if (!options.token.trim()) throw new SourceFoundryContractError('A SourceFoundry API token is required');

  const url = new URL('/v1/signals', options.baseUrl);
  if (options.tenant) url.searchParams.set('tenant', options.tenant);
  if (options.tenantId) url.searchParams.set('tenantId', options.tenantId);
  if (options.statuses?.length) url.searchParams.set('statuses', options.statuses.join(','));
  const requestedLimit = options.limit === undefined || !Number.isFinite(options.limit)
    ? 20
    : Math.floor(options.limit);
  url.searchParams.set('limit', String(Math.max(1, Math.min(100, requestedLimit))));

  let response: Response;
  try {
    response = await (options.fetchFn ?? fetch)(url, {
      headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch (error) {
    throw new SourceFoundryTransportError('SourceFoundry could not be reached', error);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown; retryable?: unknown } } | null;
    const message = typeof body?.error?.message === 'string' ? body.error.message : `SourceFoundry returned HTTP ${response.status}`;
    const retryable = typeof body?.error?.retryable === 'boolean' ? body.error.retryable : response.status >= 500;
    const code = typeof body?.error?.code === 'string' ? body.error.code : undefined;
    throw new SourceFoundryHttpError(message, response.status, retryable, code);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SourceFoundryContractError('SourceFoundry returned invalid JSON');
  }
  return parsePublicSignalsResponse(body);
}
