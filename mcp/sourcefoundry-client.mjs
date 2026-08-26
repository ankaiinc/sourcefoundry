import { createHash } from 'node:crypto';

export const DEFAULT_SOURCEFOUNDRY_BASE = 'https://feedline.4agents.fyi';

export async function buildSourceFeed({
  sourceFeed,
  apiToken,
  base = DEFAULT_SOURCEFOUNDRY_BASE,
  idempotencyKey,
  runNow = true,
  fetchImpl = fetch,
}) {
  const normalizedBase = base.replace(/\/$/, '');
  const key = idempotencyKey || `mcp-${createHash('sha256').update(stableJson(sourceFeed)).digest('hex').slice(0, 32)}`;
  const built = await requestJson(fetchImpl, `${normalizedBase}/v1/source-feeds`, {
    method: 'POST',
    headers: headers(apiToken, { 'Idempotency-Key': key }),
    body: JSON.stringify(sourceFeed),
  });
  if (!runNow) return built;
  const sourceFeedId = built.sourceFeed?.id;
  if (!sourceFeedId) throw new SourceFoundryClientError('SourceFoundry response did not include sourceFeed.id', 502, built);
  const run = await requestJson(fetchImpl, `${normalizedBase}/v1/source-feeds/${encodeURIComponent(sourceFeedId)}/runs`, {
    method: 'POST',
    headers: headers(apiToken),
  });
  return { ...built, run: run.run };
}

export async function readSourceFeed({
  sourceFeedId,
  since,
  limit,
  statuses,
  includeHealth = false,
  apiToken,
  base = DEFAULT_SOURCEFOUNDRY_BASE,
  fetchImpl = fetch,
}) {
  const normalizedBase = base.replace(/\/$/, '');
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (limit !== undefined) params.set('limit', String(limit));
  if (statuses?.length) params.set('statuses', statuses.join(','));
  const suffix = params.size ? `?${params}` : '';
  const candidates = await requestJson(
    fetchImpl,
    `${normalizedBase}/v1/source-feeds/${encodeURIComponent(sourceFeedId)}/candidates${suffix}`,
    { headers: headers(apiToken) },
  );
  if (!includeHealth) return candidates;
  const health = await requestJson(
    fetchImpl,
    `${normalizedBase}/v1/source-feeds/${encodeURIComponent(sourceFeedId)}/health`,
    { headers: headers(apiToken) },
  );
  return { ...candidates, health: health.health };
}

export class SourceFoundryClientError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'SourceFoundryClientError';
    this.status = status;
    this.body = body;
  }
}

async function requestJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new SourceFoundryClientError(body.error?.message || `SourceFoundry request failed: HTTP ${response.status}`, response.status, body);
  }
  return body;
}

function headers(apiToken, extra = {}) {
  if (!apiToken) throw new SourceFoundryClientError('SOURCEFOUNDRY_API_TOKEN is required', 401, {});
  return { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json', ...extra };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
