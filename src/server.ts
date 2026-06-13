import http from 'node:http';
import { loadConfig } from './config.js';
import { PostgresSourceFoundryRepository } from './postgres-repository.js';

const config = loadConfig();
const repo = new PostgresSourceFoundryRepository(config.databaseUrl);

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return send(res, 400, { error: 'missing url' });
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      return send(res, 200, { ok: true, service: 'sourcefoundry' });
    }

    if (!authorize(req)) {
      return send(res, 401, { error: 'unauthorized' });
    }

    if (req.method === 'POST' && url.pathname === '/v1/tenants') {
      const body = await readJson(req);
      const tenant = await repo.upsertTenant({
        slug: requiredString(body.slug, 'slug'),
        name: requiredString(body.name, 'name'),
        config: objectBody(body.config),
      });
      return send(res, 200, { tenant });
    }

    if (req.method === 'POST' && url.pathname === '/v1/sources') {
      const body = await readJson(req);
      const sourceInput: Parameters<typeof repo.createSource>[0] = {
        tenantId: requiredString(body.tenantId, 'tenantId'),
        name: requiredString(body.name, 'name'),
        sourceType: (body.sourceType ?? 'rss') as 'rss' | 'atom' | 'web',
        url: requiredString(body.url, 'url'),
        metadata: objectBody(body.metadata),
      };
      assignOptionalNumber(sourceInput, 'reliability', body.reliability);
      assignOptionalNumber(sourceInput, 'intervalMinutes', body.intervalMinutes);
      assignOptionalNumber(sourceInput, 'maxItemsPerFetch', body.maxItemsPerFetch);

      const source = await repo.createSource(sourceInput);
      return send(res, 200, { source });
    }

    if (req.method === 'POST' && url.pathname === '/v1/ingest/source') {
      const body = await readJson(req);
      const enqueueInput: Parameters<typeof repo.enqueueSourceFetch>[0] = {
        tenantId: requiredString(body.tenantId, 'tenantId'),
        sourceId: requiredString(body.sourceId, 'sourceId'),
      };
      assignOptionalNumber(enqueueInput, 'priority', body.priority);

      const jobId = await repo.enqueueSourceFetch(enqueueInput);
      return send(res, 202, { jobId });
    }

    if (req.method === 'GET' && url.pathname === '/v1/signals') {
      const tenant = url.searchParams.get('tenant') ?? undefined;
      const tenantId = url.searchParams.get('tenantId') ?? undefined;
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
      const statuses = (url.searchParams.get('statuses') ?? 'published,approved')
        .split(',')
        .map((status) => status.trim())
        .filter(Boolean);
      const listInput: Parameters<typeof repo.listSignals>[0] = {
        statuses,
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
      };
      if (tenant) listInput.tenantSlug = tenant;
      if (tenantId) listInput.tenantId = tenantId;

      const signals = await repo.listSignals(listInput);
      return send(res, 200, { signals });
    }

    return send(res, 404, { error: 'not found' });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(config.port, () => {
  console.log(`sourcefoundry api listening on ${config.port}`);
});

function authorize(req: http.IncomingMessage): boolean {
  if (!config.apiToken) return true;
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${config.apiToken}`;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function assignOptionalNumber(target: object, key: string, value: unknown): void {
  const number = optionalNumber(value);
  if (number !== undefined) {
    (target as Record<string, unknown>)[key] = number;
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
