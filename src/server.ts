import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { PostgresSourceFoundryRepository } from './postgres-repository.js';
import { validateDiscoverySourceConfiguration } from './ingest/discovery.js';
import { drainJobOnce } from './pipeline.js';
import {
  agentGuide,
  agentServiceDescriptor,
  openApiDocument,
  SOURCEFOUNDRY_AGENT_GUIDE_PATH,
  SOURCEFOUNDRY_DISCOVERY_PATH,
  SOURCEFOUNDRY_OPENAPI_PATH,
} from './agent-discovery.js';
import {
  parsePublicSignalsResponse,
  SOURCEFOUNDRY_SCHEMA_VERSION,
  SOURCEFOUNDRY_SIGNAL_STATUSES,
  SourceFoundryContractError,
} from './public-contract.js';
import type { SourceFoundryErrorCode, SourceFoundryErrorResponse } from './types.js';

const config = loadConfig(process.env, { requireApiToken: true });
const repo = new PostgresSourceFoundryRepository(config.databaseUrl);

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return send(res, 400, { error: 'missing url' });
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === SOURCEFOUNDRY_DISCOVERY_PATH)) {
      return send(res, 200, agentServiceDescriptor(config));
    }

    if (req.method === 'GET' && url.pathname === SOURCEFOUNDRY_OPENAPI_PATH) {
      return send(res, 200, openApiDocument(config));
    }

    if (req.method === 'GET' && url.pathname === SOURCEFOUNDRY_AGENT_GUIDE_PATH) {
      return sendText(res, 200, agentGuide(config));
    }

    if (url.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        service: 'sourcefoundry',
        schemaVersion: SOURCEFOUNDRY_SCHEMA_VERSION,
        release: config.releaseSha,
      });
    }

    if (url.pathname === '/ready') {
      try {
        await repo.checkReadiness();
        return send(res, 200, {
          ok: true,
          service: 'sourcefoundry',
          schemaVersion: SOURCEFOUNDRY_SCHEMA_VERSION,
          release: config.releaseSha,
        });
      } catch {
        return sendError(res, 503, 'not_ready', 'SourceFoundry database is not ready', true);
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/meta') {
      return send(res, 200, {
        schemaVersion: SOURCEFOUNDRY_SCHEMA_VERSION,
        release: config.releaseSha,
        service: 'sourcefoundry',
        capabilities: ['signals:list', 'sources:list', 'sources:create', 'ingest:enqueue', 'jobs:run-once'],
        authentication: {
          type: 'http-bearer',
          environmentVariable: 'SOURCEFOUNDRY_API_TOKEN',
          requiredFor: ['tenant and source configuration', 'ingestion', 'signal retrieval'],
        },
        documentation: {
          openapi: `${config.publicBaseUrl}${SOURCEFOUNDRY_OPENAPI_PATH}`,
          agentGuide: `${config.publicBaseUrl}${SOURCEFOUNDRY_AGENT_GUIDE_PATH}`,
        },
      });
    }

    if (!authorize(req)) {
      return sendError(res, 401, 'unauthorized', 'Unauthorized', false);
    }

    if (req.method === 'POST' && url.pathname === '/v1/tenants') {
      const body = await readJson(req);
      const tenant = await repo.upsertTenant({
        slug: requiredString(body.slug, 'slug'),
        name: requiredString(body.name, 'name'),
        config: objectBody(body.config),
      });
      return send(res, 200, versioned({ tenant }));
    }

    if (req.method === 'POST' && url.pathname === '/v1/sources') {
      const body = await readJson(req);
      const sourceInput: Parameters<typeof repo.createSource>[0] = {
        tenantId: requiredString(body.tenantId, 'tenantId'),
        name: requiredString(body.name, 'name'),
        sourceType: sourceType(body.sourceType ?? 'rss'),
        url: requiredString(body.url, 'url'),
        metadata: objectBody(body.metadata),
      };
      assignOptionalNumber(sourceInput, 'reliability', body.reliability, { minimum: 0, maximum: 1 });
      assignOptionalNumber(sourceInput, 'intervalMinutes', body.intervalMinutes, { minimum: 1, maximum: 10_080, integer: true });
      assignOptionalNumber(sourceInput, 'maxItemsPerFetch', body.maxItemsPerFetch, { minimum: 1, maximum: 100, integer: true });
      assignOptionalNumber(sourceInput, 'timeoutSeconds', body.timeoutSeconds, { minimum: 1, maximum: 300, integer: true });

      validateDiscoverySourceConfiguration({
        id: 'pending',
        tenantId: sourceInput.tenantId,
        name: sourceInput.name,
        sourceType: sourceInput.sourceType,
        url: sourceInput.url,
        enabled: true,
        reliability: sourceInput.reliability ?? 0.7,
        intervalMinutes: sourceInput.intervalMinutes ?? 60,
        maxItemsPerFetch: sourceInput.maxItemsPerFetch ?? 30,
        timeoutSeconds: sourceInput.timeoutSeconds ?? 20,
        failureCount: 0,
        metadata: sourceInput.metadata ?? {},
      });

      const source = await repo.createSource(sourceInput);
      return send(res, 200, versioned({ source }));
    }

    if (req.method === 'GET' && url.pathname === '/v1/sources') {
      const tenantSlug = url.searchParams.get('tenant') ?? undefined;
      const tenantId = url.searchParams.get('tenantId') ?? undefined;
      if (!tenantSlug && !tenantId) throw new ApiError(400, 'bad_request', 'tenant or tenantId is required');
      const sources = await repo.listSources({ ...(tenantSlug ? { tenantSlug } : {}), ...(tenantId ? { tenantId } : {}) });
      return send(res, 200, versioned({ sources }));
    }

    const sourceMatch = url.pathname.match(/^\/v1\/sources\/([0-9a-f-]{36})$/i);
    if (req.method === 'GET' && sourceMatch) {
      const source = await repo.getSource(sourceMatch[1]!);
      return source ? send(res, 200, versioned({ source })) : sendError(res, 404, 'not_found', 'Source not found', false);
    }

    if (req.method === 'POST' && url.pathname === '/v1/ingest/source') {
      const body = await readJson(req);
      const enqueueInput: Parameters<typeof repo.enqueueSourceFetch>[0] = {
        tenantId: requiredString(body.tenantId, 'tenantId'),
        sourceId: requiredString(body.sourceId, 'sourceId'),
      };
      assignOptionalNumber(enqueueInput, 'priority', body.priority, { minimum: -100, maximum: 100, integer: true });

      const enqueueResult = await repo.enqueueSourceFetch(enqueueInput);
      return send(res, 202, versioned(enqueueResult));
    }

    const runJobMatch = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]{36})\/run-once$/i);
    if (req.method === 'POST' && runJobMatch) {
      const result = await drainJobOnce(repo, runJobMatch[1]!, { maxAttempts: config.maxAttempts });
      if (result.detail.claimed === 0) {
        throw new ApiError(409, 'bad_request', 'Job is not currently claimable');
      }
      return send(res, 200, versioned(result));
    }

    if (req.method === 'GET' && url.pathname === '/v1/signals') {
      const tenant = url.searchParams.get('tenant') ?? undefined;
      const tenantId = url.searchParams.get('tenantId') ?? undefined;
      if (!tenant && !tenantId) throw new ApiError(400, 'bad_request', 'tenant or tenantId is required');
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
      const statuses = (url.searchParams.get('statuses') ?? 'published,approved')
        .split(',')
        .map((status) => status.trim())
        .filter(Boolean);
      const allowedStatuses = new Set<string>(SOURCEFOUNDRY_SIGNAL_STATUSES);
      if (statuses.length === 0 || statuses.some((status) => !allowedStatuses.has(status))) {
        throw new ApiError(400, 'bad_request', 'statuses contains an unsupported signal status');
      }
      const listInput: Parameters<typeof repo.listSignals>[0] = {
        statuses,
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
      };
      if (tenant) listInput.tenantSlug = tenant;
      if (tenantId) listInput.tenantId = tenantId;

      const signals = await repo.listSignals(listInput);
      const response = parsePublicSignalsResponse(versioned({ signals }));
      return send(res, 200, response);
    }

    return sendError(res, 404, 'not_found', 'Not found', false);
  } catch (error) {
    if (error instanceof ApiError) {
      return sendError(res, error.status, error.code, error.message, error.status >= 500);
    }
    if (error instanceof SourceFoundryContractError) {
      console.error('SourceFoundry outgoing contract violation', error);
      return sendError(res, 500, 'contract_violation', 'SourceFoundry could not produce a valid response', false);
    }
    console.error('SourceFoundry request failed', error);
    return sendError(res, 500, 'internal_error', 'Internal server error', true);
  }
});

server.listen(config.port, () => {
  console.log(`sourcefoundry api listening on ${config.port}`);
});

function authorize(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${config.apiToken}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-sourcefoundry-schema-version': String(SOURCEFOUNDRY_SCHEMA_VERSION),
    'x-sourcefoundry-release': config.releaseSha,
  });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/markdown; charset=utf-8',
    'cache-control': 'no-store',
    'x-sourcefoundry-schema-version': String(SOURCEFOUNDRY_SCHEMA_VERSION),
    'x-sourcefoundry-release': config.releaseSha,
  });
  res.end(body);
}

function sendError(
  res: http.ServerResponse,
  status: number,
  code: SourceFoundryErrorCode,
  message: string,
  retryable: boolean,
): void {
  const body: SourceFoundryErrorResponse = {
    schemaVersion: SOURCEFOUNDRY_SCHEMA_VERSION,
    release: config.releaseSha,
    error: { code, message, retryable },
  };
  send(res, status, body);
}

function versioned<T extends object>(body: T): T & { schemaVersion: 1; release: string } {
  return { schemaVersion: SOURCEFOUNDRY_SCHEMA_VERSION, release: config.releaseSha, ...body };
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1_000_000) throw new ApiError(413, 'bad_request', 'Request body exceeds 1 MB');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'bad_request', 'Request body must be valid JSON');
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'bad_request', `${field} is required`);
  return value.trim();
}

function sourceType(value: unknown): 'rss' | 'atom' | 'web' {
  if (value === 'rss' || value === 'atom' || value === 'web') return value;
  throw new ApiError(400, 'bad_request', 'sourceType must be rss, atom, or web');
}

function assignOptionalNumber(
  target: object,
  key: string,
  value: unknown,
  bounds: { minimum: number; maximum: number; integer?: boolean },
): void {
  if (value === undefined) return;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < bounds.minimum
    || value > bounds.maximum
    || (bounds.integer && !Number.isInteger(value))
  ) {
    throw new ApiError(
      400,
      'bad_request',
      `${key} must be ${bounds.integer ? 'an integer' : 'a number'} between ${bounds.minimum} and ${bounds.maximum}`,
    );
  }
  (target as Record<string, unknown>)[key] = value;
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: SourceFoundryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
