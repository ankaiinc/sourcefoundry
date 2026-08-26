import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { AgentSourceLimitError, PostgresSourceFoundryRepository } from './postgres-repository.js';
import { validateDiscoverySourceConfiguration } from './ingest/discovery.js';
import { drainJobOnce } from './pipeline.js';
import {
  agentGuide,
  agentServiceDescriptor,
  openApiDocument,
  SOURCEFOUNDRY_AGENT_GUIDE_PATH,
  SOURCEFOUNDRY_DISCOVERY_PATH,
  SOURCEFOUNDRY_LLMS_PATH,
  SOURCEFOUNDRY_OPENAPI_PATH,
} from './agent-discovery.js';
import { createAgentToken, tokenHash, tokenPrefix, validateAgentSourcePolicy } from './agent-access.js';
import { landingPage } from './landing.js';
import { robotsTxt, sitemapXml } from './public-discovery.js';
import type { AgentCredential, SignalSource, SourceFeed, SourceFeedRun } from './types.js';
import { buildSourceFeed, enqueueSourceFeedRun, SourceFeedRunLimitError, type SourceFeedSourceRequest } from './source-feeds.js';
import {
  parsePublicSignalsResponse,
  SOURCEFOUNDRY_SCHEMA_VERSION,
  SOURCEFOUNDRY_SIGNAL_STATUSES,
  SourceFoundryContractError,
} from './public-contract.js';
import type { SourceFoundryErrorCode, SourceFoundryErrorResponse } from './types.js';

const config = loadConfig(process.env, { requireApiToken: true });
const repo = new PostgresSourceFoundryRepository(config.databaseUrl);
const sourcefoundrySocialCard = readFileSync(new URL('../../public/sourcefoundry-og.png', import.meta.url));
const sourcefoundryFavicon = readFileSync(new URL('../../public/favicon.svg', import.meta.url));

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return send(res, 400, { error: 'missing url' });
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      return sendHtml(res, 200, landingPage(config.publicBaseUrl));
    }

    if (req.method === 'GET' && url.pathname === '/robots.txt') {
      return sendPublicText(res, 200, robotsTxt(config.publicBaseUrl), 'text/plain; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
      return sendPublicText(res, 200, sitemapXml(config.publicBaseUrl), 'application/xml; charset=utf-8');
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/sourcefoundry-og.png' || url.pathname === '/feedline-og.png')) {
      return sendPublicAsset(res, 200, sourcefoundrySocialCard, 'image/png', req.method === 'HEAD');
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/favicon.svg') {
      return sendPublicAsset(res, 200, sourcefoundryFavicon, 'image/svg+xml; charset=utf-8', req.method === 'HEAD');
    }

    if (req.method === 'GET' && url.pathname === SOURCEFOUNDRY_DISCOVERY_PATH) {
      return send(res, 200, agentServiceDescriptor(config));
    }

    if (req.method === 'GET' && url.pathname === SOURCEFOUNDRY_OPENAPI_PATH) {
      return send(res, 200, openApiDocument(config));
    }

    if (req.method === 'GET' && (url.pathname === SOURCEFOUNDRY_AGENT_GUIDE_PATH || url.pathname === SOURCEFOUNDRY_LLMS_PATH)) {
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
        capabilities: ['source-feeds:build', 'source-feeds:run', 'source-feeds:read', 'source-feeds:health', 'signals:list', 'sources:list', 'sources:create', 'ingest:enqueue', 'jobs:run-once'],
        authentication: {
          type: 'http-bearer',
          environmentVariable: 'SOURCEFOUNDRY_API_TOKEN',
          requiredFor: ['tenant and source configuration', 'ingestion', 'signal retrieval'],
        },
        selfService: {
          enrollment: `${config.publicBaseUrl}/v1/agent-enrollments`,
          enabled: config.selfService.enabled,
          sourceLimit: config.selfService.maxSources,
          minimumIntervalMinutes: config.selfService.minIntervalMinutes,
          maximumItemsPerFetch: config.selfService.maxItemsPerFetch,
        },
        documentation: {
          openapi: `${config.publicBaseUrl}${SOURCEFOUNDRY_OPENAPI_PATH}`,
          agentGuide: `${config.publicBaseUrl}${SOURCEFOUNDRY_AGENT_GUIDE_PATH}`,
          llms: `${config.publicBaseUrl}${SOURCEFOUNDRY_LLMS_PATH}`,
        },
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/agent-enrollments') {
      return enrollAgent(req, res);
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/v1/')) {
      return sendHtml(res, 404, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found — SourceFoundry</title></head><body><main><h1>Not found</h1><p><a href="/">Return to SourceFoundry</a></p></main></body></html>');
    }

    const access = await authenticate(req);
    if (!access) {
      return sendError(res, 401, 'unauthorized', 'Unauthorized', false);
    }

    if (req.method === 'POST' && url.pathname === '/v1/tenants') {
      if (access.kind === 'agent') throw new ApiError(403, 'forbidden', 'Agent workspaces are created through /v1/agent-enrollments');
      const body = await readJson(req);
      const tenant = await repo.upsertTenant({
        slug: requiredString(body.slug, 'slug'),
        name: requiredString(body.name, 'name'),
        config: objectBody(body.config),
      });
      return send(res, 200, versioned({ tenant }));
    }

    if (req.method === 'POST' && url.pathname === '/v1/source-feeds') {
      const body = await readJson(req);
      const tenantId = access.kind === 'agent'
        ? access.credential.tenantId
        : requiredString(body.tenantId, 'tenantId');
      assertAccessTenantId(access, tenantId);
      if (!await repo.getTenantById(tenantId)) throw new ApiError(404, 'not_found', 'Tenant not found');
      const idempotencyKey = requiredHeader(req, 'idempotency-key');
      const everyMinutes = boundedInteger(objectBody(body.cadence).everyMinutes, 'cadence.everyMinutes', 5, 10_080, 60);
      const maxItemsPerRun = boundedInteger(objectBody(body.limits).maxItemsPerRun, 'limits.maxItemsPerRun', 1, 100, 20);
      const maxCandidatesPerRun = boundedInteger(objectBody(body.limits).maxCandidatesPerRun, 'limits.maxCandidatesPerRun', 1, 100, 10);
      let built;
      try {
        built = await buildSourceFeed(repo, {
          tenantId,
          idempotencyKey,
          name: boundedString(body.name, 'name', 160),
          purpose: boundedString(body.purpose, 'purpose', 2_000),
          sources: sourceFeedSources(body.sources),
          everyMinutes,
          maxItemsPerRun,
          maxCandidatesPerRun,
        }, {
          agentManaged: access.kind === 'agent',
          minIntervalMinutes: access.kind === 'agent' ? config.selfService.minIntervalMinutes : 5,
          maxItemsPerFetch: access.kind === 'agent' ? config.selfService.maxItemsPerFetch : 100,
          ...(access.kind === 'agent' ? { maxSources: config.selfService.maxSources } : {}),
        });
      } catch (error) {
        if (error instanceof AgentSourceLimitError || error instanceof Error && error.message.includes('Autonomous workspace source limit')) {
          throw new ApiError(429, 'rate_limited', `Autonomous workspaces may configure at most ${config.selfService.maxSources} sources`);
        }
        throw new ApiError(400, 'bad_request', error instanceof Error ? error.message : String(error));
      }
      return send(res, 200, versioned({
        sourceFeed: publicSourceFeed(built.sourceFeed),
        sourcePlan: built.sourcePlan,
      }));
    }

    const sourceFeedRunMatch = url.pathname.match(/^\/v1\/source-feeds\/([0-9a-f-]{36})\/runs$/i);
    if (req.method === 'POST' && sourceFeedRunMatch) {
      const sourceFeed = await repo.getSourceFeed(sourceFeedRunMatch[1]!);
      if (!sourceFeed) throw new ApiError(404, 'not_found', 'Source feed not found');
      assertAccessTenantId(access, sourceFeed.tenantId);
      try {
        const run = await enqueueSourceFeedRun(repo, sourceFeed, access.kind === 'agent' ? {
          perTenantPerDay: config.selfService.maxRunsPerTenantPerDay,
          serviceTotalPerDay: config.selfService.maxRunsTotalPerDay,
        } : undefined);
        return send(res, 202, versioned({ run: publicSourceFeedRun(run) }));
      } catch (error) {
        if (error instanceof SourceFeedRunLimitError) {
          throw new ApiError(429, 'rate_limited', error.limit === 'tenant_daily'
            ? `Autonomous workspaces may enqueue at most ${config.selfService.maxRunsPerTenantPerDay} source runs per day`
            : 'Autonomous service capacity is currently full; retry tomorrow');
        }
        throw error;
      }
    }

    const sourceFeedCandidatesMatch = url.pathname.match(/^\/v1\/source-feeds\/([0-9a-f-]{36})\/candidates$/i);
    if (req.method === 'GET' && sourceFeedCandidatesMatch) {
      const sourceFeed = await repo.getSourceFeed(sourceFeedCandidatesMatch[1]!);
      if (!sourceFeed) throw new ApiError(404, 'not_found', 'Source feed not found');
      assertAccessTenantId(access, sourceFeed.tenantId);
      const requestedLimit = boundedInteger(url.searchParams.get('limit') === null ? undefined : Number(url.searchParams.get('limit')), 'limit', 1, 100, 20);
      const limit = Math.min(requestedLimit, sourceFeed.maxCandidatesPerRun);
      const since = optionalTimestampParameter(url.searchParams.get('since'), 'since');
      if (url.searchParams.has('cursor')) throw new ApiError(400, 'bad_request', 'cursor pagination is not available in this release; use since for incremental sync');
      const statuses = signalStatuses(url.searchParams.get('statuses') ?? 'published,approved,ready_for_review');
      const candidates = await repo.listSignals({
        tenantId: sourceFeed.tenantId,
        sourceFeedId: sourceFeed.id,
        ...(since ? { since } : {}),
        statuses,
        limit,
      });
      return send(res, 200, versioned({
        sourceFeedId: sourceFeed.id,
        generatedAt: new Date().toISOString(),
        candidates,
        page: { nextCursor: null, truncated: false },
      }));
    }

    const sourceFeedHealthMatch = url.pathname.match(/^\/v1\/source-feeds\/([0-9a-f-]{36})\/health$/i);
    if (req.method === 'GET' && sourceFeedHealthMatch) {
      const sourceFeed = await repo.getSourceFeed(sourceFeedHealthMatch[1]!);
      if (!sourceFeed) throw new ApiError(404, 'not_found', 'Source feed not found');
      assertAccessTenantId(access, sourceFeed.tenantId);
      const health = await repo.getSourceFeedHealth(sourceFeed.id);
      return send(res, 200, versioned({ health }));
    }

    const sourceFeedRunStatusMatch = url.pathname.match(/^\/v1\/source-feed-runs\/([0-9a-f-]{36})$/i);
    if (req.method === 'GET' && sourceFeedRunStatusMatch) {
      const run = await repo.getSourceFeedRun(sourceFeedRunStatusMatch[1]!);
      if (!run) throw new ApiError(404, 'not_found', 'Source feed run not found');
      assertAccessTenantId(access, run.tenantId);
      return send(res, 200, versioned({ run: publicSourceFeedRun(run) }));
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

      if (access.kind === 'agent') {
        assertAgentTenant(access.credential, sourceInput.tenantId);
        try {
          validateAgentSourcePolicy({
            sourceType: sourceInput.sourceType,
            url: sourceInput.url,
            intervalMinutes: sourceInput.intervalMinutes ?? 60,
            maxItemsPerFetch: sourceInput.maxItemsPerFetch ?? 30,
            metadata: sourceInput.metadata ?? {},
          }, {
            minIntervalMinutes: config.selfService.minIntervalMinutes,
            maxItemsPerFetch: config.selfService.maxItemsPerFetch,
          });
        } catch (error) {
          throw new ApiError(400, 'bad_request', error instanceof Error ? error.message : String(error));
        }
        sourceInput.agentManaged = true;
        sourceInput.maxAgentManagedSources = config.selfService.maxSources;
      }

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

      let source: SignalSource;
      try {
        source = await repo.createSource(sourceInput);
      } catch (error) {
        if (error instanceof AgentSourceLimitError || error instanceof Error && error.message === 'Autonomous workspace source limit reached') {
          throw new ApiError(429, 'rate_limited', `Autonomous workspaces may configure at most ${config.selfService.maxSources} sources`);
        }
        throw error;
      }
      return send(res, 200, versioned({ source }));
    }

    if (req.method === 'GET' && url.pathname === '/v1/sources') {
      const tenantSlug = url.searchParams.get('tenant') ?? undefined;
      const tenantId = url.searchParams.get('tenantId') ?? undefined;
      if (!tenantSlug && !tenantId) throw new ApiError(400, 'bad_request', 'tenant or tenantId is required');
      await assertTenantQueryAccess(access, tenantSlug, tenantId);
      const sources = await repo.listSources({ ...(tenantSlug ? { tenantSlug } : {}), ...(tenantId ? { tenantId } : {}) });
      return send(res, 200, versioned({ sources }));
    }

    const sourceMatch = url.pathname.match(/^\/v1\/sources\/([0-9a-f-]{36})$/i);
    if (req.method === 'GET' && sourceMatch) {
      const source = await repo.getSource(sourceMatch[1]!);
      if (source) assertSourceAccess(access, source);
      return source ? send(res, 200, versioned({ source })) : sendError(res, 404, 'not_found', 'Source not found', false);
    }

    if (req.method === 'POST' && url.pathname === '/v1/ingest/source') {
      const body = await readJson(req);
      const enqueueInput: Parameters<typeof repo.enqueueSourceFetch>[0] = {
        tenantId: requiredString(body.tenantId, 'tenantId'),
        sourceId: requiredString(body.sourceId, 'sourceId'),
      };
      assignOptionalNumber(enqueueInput, 'priority', body.priority, { minimum: -100, maximum: 100, integer: true });
      assertAccessTenantId(access, enqueueInput.tenantId);
      const source = await repo.getSource(enqueueInput.sourceId);
      if (!source || source.tenantId !== enqueueInput.tenantId) {
        throw new ApiError(404, 'not_found', 'Source not found');
      }

      const enqueueResult = await repo.enqueueSourceFetch({
        ...enqueueInput,
        ...(access.kind === 'agent' ? {
          agentRunBudget: {
            perTenantPerDay: config.selfService.maxRunsPerTenantPerDay,
            serviceTotalPerDay: config.selfService.maxRunsTotalPerDay,
          },
        } : {}),
      });
      if (enqueueResult.limited) {
        const message = enqueueResult.limited === 'tenant_daily'
          ? `Autonomous workspaces may enqueue at most ${config.selfService.maxRunsPerTenantPerDay} runs per day`
          : 'Autonomous service capacity is currently full; retry tomorrow';
        throw new ApiError(429, 'rate_limited', message);
      }
      return send(res, 202, versioned(enqueueResult));
    }

    const runJobMatch = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]{36})\/run-once$/i);
    if (req.method === 'POST' && runJobMatch) {
      if (access.kind === 'agent') throw new ApiError(403, 'forbidden', 'Autonomous workspaces enqueue work; they do not run jobs directly');
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
      await assertTenantQueryAccess(access, tenant, tenantId);
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

async function enrollAgent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!config.selfService.enabled) throw new ApiError(403, 'forbidden', 'Autonomous enrollment is not enabled');
  const body = await readJson(req);
  const slug = requiredSlug(body.slug);
  const name = requiredString(body.name, 'name');
  const label = requiredString(body.agentLabel ?? 'autonomous-agent', 'agentLabel');
  const token = createAgentToken();
  const enrollment = await repo.createAutonomousEnrollment({
    slug,
    name,
    label,
    tokenHash: tokenHash(token),
    tokenPrefix: tokenPrefix(token),
    maxEnrollmentsPerDay: config.selfService.maxEnrollmentsPerDay,
  });
  if (enrollment && 'limited' in enrollment) {
    throw new ApiError(429, 'rate_limited', 'Autonomous enrollment capacity is currently full; retry tomorrow');
  }
  if (!enrollment) throw new ApiError(409, 'conflict', 'That workspace slug is already claimed');
  const { tenant, credential } = enrollment;
  return send(res, 201, versioned({
    tenant,
    credential: { id: credential.id, label: credential.label, tokenPrefix: credential.tokenPrefix },
    token,
    tokenDelivery: 'This token is shown exactly once. Store it in the agent runtime secret store as SOURCEFOUNDRY_API_TOKEN.',
    baseUrl: config.publicBaseUrl,
    next: {
      openapi: `${config.publicBaseUrl}${SOURCEFOUNDRY_OPENAPI_PATH}`,
      buildSourceFeed: `${config.publicBaseUrl}/v1/source-feeds`,
      createSource: `${config.publicBaseUrl}/v1/sources`,
      sourceLimit: config.selfService.maxSources,
      minimumIntervalMinutes: config.selfService.minIntervalMinutes,
      maximumItemsPerFetch: config.selfService.maxItemsPerFetch,
    },
  }));
}

type Access = { kind: 'operator' } | { kind: 'agent'; credential: AgentCredential };

async function authenticate(req: http.IncomingMessage): Promise<Access | null> {
  const header = req.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${config.apiToken}`);
  const received = Buffer.from(header);
  if (received.length === expected.length && timingSafeEqual(received, expected)) return { kind: 'operator' };
  const token = header.startsWith('Bearer sfa_') ? header.slice('Bearer '.length) : '';
  if (!token) return null;
  const credential = await repo.findActiveAgentCredential(tokenHash(token));
  return credential ? { kind: 'agent', credential } : null;
}

function assertAgentTenant(credential: AgentCredential, tenantId: string): void {
  if (credential.tenantId !== tenantId) throw new ApiError(403, 'forbidden', 'This agent credential is scoped to a different workspace');
}

function assertAccessTenantId(access: Access, tenantId: string): void {
  if (access.kind === 'agent') assertAgentTenant(access.credential, tenantId);
}

async function assertTenantQueryAccess(access: Access, tenantSlug?: string, tenantId?: string): Promise<void> {
  if (access.kind === 'operator') return;
  if (tenantId) return assertAgentTenant(access.credential, tenantId);
  const tenant = tenantSlug ? await repo.getTenantBySlug(tenantSlug) : null;
  if (!tenant) throw new ApiError(404, 'not_found', 'Tenant not found');
  assertAgentTenant(access.credential, tenant.id);
}

function assertSourceAccess(access: Access, source: SignalSource): void {
  if (access.kind === 'agent') assertAgentTenant(access.credential, source.tenantId);
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-sourcefoundry-schema-version': String(SOURCEFOUNDRY_SCHEMA_VERSION),
    'x-sourcefoundry-release': config.releaseSha,
    ...securityHeaders(),
  });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/markdown; charset=utf-8',
    'cache-control': 'no-store',
    'x-sourcefoundry-schema-version': String(SOURCEFOUNDRY_SCHEMA_VERSION),
    'x-sourcefoundry-release': config.releaseSha,
    ...securityHeaders(),
  });
  res.end(body);
}

function sendPublicText(res: http.ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'public, max-age=300',
    'x-sourcefoundry-schema-version': String(SOURCEFOUNDRY_SCHEMA_VERSION),
    'x-sourcefoundry-release': config.releaseSha,
    ...securityHeaders(),
  });
  res.end(body);
}

function sendPublicAsset(
  res: http.ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  headOnly = false,
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': String(body.byteLength),
    'cache-control': 'public, max-age=31536000, immutable',
    'x-sourcefoundry-schema-version': String(SOURCEFOUNDRY_SCHEMA_VERSION),
    'x-sourcefoundry-release': config.releaseSha,
    ...securityHeaders(),
  });
  res.end(headOnly ? undefined : body);
}

function sendHtml(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-sourcefoundry-schema-version': String(SOURCEFOUNDRY_SCHEMA_VERSION),
    'x-sourcefoundry-release': config.releaseSha,
    ...securityHeaders(),
  });
  res.end(body);
}

function securityHeaders(): Record<string, string> {
  return {
    'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'; font-src https://fonts.gstatic.com; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com",
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'clipboard-write=(self)',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
  };
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

function boundedString(value: unknown, field: string, maximum: number): string {
  const result = requiredString(value, field);
  if (result.length > maximum) throw new ApiError(400, 'bad_request', `${field} must be at most ${maximum} characters`);
  return result;
}

function requiredHeader(req: http.IncomingMessage, name: string): string {
  const value = req.headers[name];
  const result = Array.isArray(value) ? value[0] : value;
  if (!result?.trim()) throw new ApiError(400, 'bad_request', `${name} header is required`);
  if (result.length > 200) throw new ApiError(400, 'bad_request', `${name} header must be at most 200 characters`);
  return result.trim();
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ApiError(400, 'bad_request', `${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function sourceFeedSources(value: unknown): SourceFeedSourceRequest[] {
  if (!Array.isArray(value)) throw new ApiError(400, 'bad_request', 'sources must be an array');
  if (value.length > 100) throw new ApiError(400, 'bad_request', 'sources may contain at most 100 entries');
  return value.map((entry, index) => {
    const body = objectBody(entry);
    const kind = body.kind;
    if (kind !== 'feed' && kind !== 'page' && kind !== 'discovery') {
      throw new ApiError(400, 'bad_request', `sources[${index}].kind must be feed, page, or discovery`);
    }
    if (body.required !== undefined && typeof body.required !== 'boolean') {
      throw new ApiError(400, 'bad_request', `sources[${index}].required must be a boolean`);
    }
    if (body.provider !== undefined && body.provider !== 'tavily' && body.provider !== 'exa' && body.provider !== 'serper') {
      throw new ApiError(400, 'bad_request', `sources[${index}].provider must be tavily, exa, or serper`);
    }
    return {
      kind,
      label: boundedString(body.label, `sources[${index}].label`, 160),
      ...(typeof body.url === 'string' ? { url: body.url } : {}),
      ...(body.provider === 'tavily' || body.provider === 'exa' || body.provider === 'serper' ? { provider: body.provider } : {}),
      ...(body.required === true ? { required: true } : {}),
      ...(body.queries !== undefined ? { queries: stringArray(body.queries, `sources[${index}].queries`) } : {}),
      ...(body.includeDomains !== undefined ? { includeDomains: stringArray(body.includeDomains, `sources[${index}].includeDomains`) } : {}),
      ...(body.excludeDomains !== undefined ? { excludeDomains: stringArray(body.excludeDomains, `sources[${index}].excludeDomains`) } : {}),
    };
  });
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ApiError(400, 'bad_request', `${field} must be an array of strings`);
  }
  return value as string[];
}

function optionalTimestampParameter(value: string | null, field: string): string | undefined {
  if (value === null) return undefined;
  if (!Number.isFinite(Date.parse(value))) throw new ApiError(400, 'bad_request', `${field} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function signalStatuses(value: string): string[] {
  const statuses = value.split(',').map((status) => status.trim()).filter(Boolean);
  const allowed = new Set<string>(SOURCEFOUNDRY_SIGNAL_STATUSES);
  if (statuses.length === 0 || statuses.some((status) => !allowed.has(status))) {
    throw new ApiError(400, 'bad_request', 'statuses contains an unsupported signal status');
  }
  return statuses;
}

function publicSourceFeed(sourceFeed: SourceFeed): Record<string, unknown> {
  return {
    ...sourceFeed,
    nextRunAt: new Date(Date.parse(sourceFeed.updatedAt) + sourceFeed.everyMinutes * 60_000).toISOString(),
    candidatesUrl: `${config.publicBaseUrl}/v1/source-feeds/${sourceFeed.id}/candidates`,
    healthUrl: `${config.publicBaseUrl}/v1/source-feeds/${sourceFeed.id}/health`,
  };
}

function publicSourceFeedRun(run: SourceFeedRun & { reusedJobs?: number }): Record<string, unknown> {
  return {
    ...run,
    statusUrl: `${config.publicBaseUrl}/v1/source-feed-runs/${run.id}`,
    retryAfterSeconds: run.status === 'queued' || run.status === 'collecting' ? 5 : 0,
  };
}

function requiredSlug(value: unknown): string {
  const slug = requiredString(value, 'slug').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(slug)) {
    throw new ApiError(400, 'bad_request', 'slug must be 3-63 lowercase letters, numbers, or hyphens');
  }
  return slug;
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
