import type {
  PublicSignal,
  PublicSignalsResponse,
  SignalConversation,
  SignalConversationParticipant,
  SignalObservation,
} from './types.js';

export const SOURCEFOUNDRY_SCHEMA_VERSION = 1 as const;
export const SOURCEFOUNDRY_SIGNAL_STATUSES = [
  'draft',
  'ready_for_review',
  'approved',
  'published',
  'rejected',
] as const;

export class SourceFoundryContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFoundryContractError';
  }
}

export function parsePublicSignalsResponse(value: unknown): PublicSignalsResponse {
  const response = record(value);
  if (response.schemaVersion !== SOURCEFOUNDRY_SCHEMA_VERSION) {
    throw new SourceFoundryContractError(`Unsupported SourceFoundry schema version: ${String(response.schemaVersion)}`);
  }
  if (!nonemptyString(response.release)) {
    throw new SourceFoundryContractError('SourceFoundry response is missing release identity');
  }
  if (!Array.isArray(response.signals)) {
    throw new SourceFoundryContractError('SourceFoundry response signals must be an array');
  }
  response.signals.forEach((signal, index) => assertPublicSignal(signal, `signals[${index}]`));
  return response as unknown as PublicSignalsResponse;
}

export function assertPublicSignal(value: unknown, path = 'signal'): asserts value is PublicSignal {
  const signal = record(value, path);
  requiredStringFields(signal, path, ['id', 'tenantId', 'title', 'summary', 'url', 'status', 'generatedAt']);
  if (!(SOURCEFOUNDRY_SIGNAL_STATUSES as readonly unknown[]).includes(signal.status)) fail(path, 'status is invalid');
  if (signal.schemaVersion !== SOURCEFOUNDRY_SCHEMA_VERSION) fail(path, 'schemaVersion must be 1');
  if (!unitNumber(signal.score)) fail(path, 'score must be between 0 and 1');
  assertUrl(signal.url, `${path}.url`);
  assertTimestamp(signal.generatedAt, `${path}.generatedAt`);
  if (!stringArray(signal.tags)) fail(path, 'tags must be an array of strings');
  if (!nullableString(signal.publishedAt)) fail(path, 'publishedAt must be a string or null');
  if (signal.publishedAt !== null) assertTimestamp(signal.publishedAt, `${path}.publishedAt`);

  const source = record(signal.source, `${path}.source`);
  requiredStringFields(source, `${path}.source`, ['id', 'name', 'type', 'provider']);
  if (!['rss', 'atom', 'web'].includes(String(source.type))) fail(`${path}.source`, 'type is invalid');
  if (!unitNumber(source.reliability)) fail(`${path}.source`, 'reliability must be between 0 and 1');

  const provenance = record(signal.provenance, `${path}.provenance`);
  requiredStringFields(provenance, `${path}.provenance`, ['sourceItemId', 'canonicalUrl', 'fetchedAt', 'contentHash']);
  assertUrl(provenance.canonicalUrl, `${path}.provenance.canonicalUrl`);
  assertTimestamp(provenance.fetchedAt, `${path}.provenance.fetchedAt`);
  if (!nullableString(provenance.author) || !nullableString(provenance.query)) {
    fail(`${path}.provenance`, 'author and query must be strings or null');
  }

  assertFreshness(signal.freshness, `${path}.freshness`);
  assertCompleteness(signal.completeness, `${path}.completeness`);
  assertFailureState(signal.failureState, `${path}.failureState`);

  const aggregation = record(signal.aggregation, `${path}.aggregation`);
  if (!nonemptyString(aggregation.signalKey)) fail(`${path}.aggregation`, 'signalKey is required');
  if (!nonnegativeInteger(aggregation.observationCount) || !nonnegativeInteger(aggregation.sourceCount)) {
    fail(`${path}.aggregation`, 'observationCount and sourceCount must be non-negative integers');
  }
  if (typeof aggregation.capped !== 'boolean') fail(`${path}.aggregation`, 'capped must be boolean');

  if (!Array.isArray(signal.observations)) fail(path, 'observations must be an array');
  if (signal.observations.length > 3) fail(path, 'observations must contain no more than 3 items');
  signal.observations.forEach((observation, index) => assertObservation(observation, `${path}.observations[${index}]`));
  if (signal.conversation !== undefined) assertConversation(signal.conversation, `${path}.conversation`);
}

function assertObservation(value: unknown, path: string): asserts value is SignalObservation {
  const observation = record(value, path);
  requiredStringFields(observation, path, ['candidateId', 'title', 'summary', 'url', 'generatedAt']);
  if (!unitNumber(observation.score)) fail(path, 'score must be between 0 and 1');
  assertUrl(observation.url, `${path}.url`);
  assertTimestamp(observation.generatedAt, `${path}.generatedAt`);
  if (!nullableString(observation.publishedAt)) fail(path, 'publishedAt must be a string or null');
  if (observation.publishedAt !== null) assertTimestamp(observation.publishedAt, `${path}.publishedAt`);

  const source = record(observation.source, `${path}.source`);
  requiredStringFields(source, `${path}.source`, ['id', 'name', 'type', 'provider']);
  if (!['rss', 'atom', 'web'].includes(String(source.type))) fail(`${path}.source`, 'type is invalid');
  if (!unitNumber(source.reliability)) fail(`${path}.source`, 'reliability must be between 0 and 1');

  const provenance = record(observation.provenance, `${path}.provenance`);
  requiredStringFields(provenance, `${path}.provenance`, ['sourceItemId', 'canonicalUrl', 'fetchedAt', 'contentHash']);
  assertUrl(provenance.canonicalUrl, `${path}.provenance.canonicalUrl`);
  assertTimestamp(provenance.fetchedAt, `${path}.provenance.fetchedAt`);
  if (!nullableString(provenance.author) || !nullableString(provenance.query)) {
    fail(`${path}.provenance`, 'author and query must be strings or null');
  }
  assertFreshness(observation.freshness, `${path}.freshness`);
  assertCompleteness(observation.completeness, `${path}.completeness`);
  assertFailureState(observation.failureState, `${path}.failureState`);
  if (observation.conversation !== undefined) assertConversation(observation.conversation, `${path}.conversation`);
}

function assertFreshness(value: unknown, path: string): void {
  const freshness = record(value, path);
  if (!nullableString(freshness.publishedAt) || !nonemptyString(freshness.fetchedAt) || !nonnegativeInteger(freshness.ageSeconds)) {
    fail(path, 'publishedAt, fetchedAt, or ageSeconds is invalid');
  }
  if (freshness.publishedAt !== null) assertTimestamp(freshness.publishedAt, `${path}.publishedAt`);
  assertTimestamp(freshness.fetchedAt, `${path}.fetchedAt`);
}

function assertCompleteness(value: unknown, path: string): void {
  const completeness = record(value, path);
  for (const field of ['title', 'summary', 'author', 'publishedAt']) {
    if (typeof completeness[field] !== 'boolean') fail(path, `${field} must be boolean`);
  }
}

function assertFailureState(value: unknown, path: string): void {
  const state = record(value, path);
  if (state.state !== 'healthy' && state.state !== 'degraded') fail(path, 'state is invalid');
  if (!nonnegativeInteger(state.consecutiveFailures)) fail(path, 'consecutiveFailures must be a non-negative integer');
  if (!nullableString(state.lastSuccessAt) || !nullableString(state.lastFailureAt)) {
    fail(path, 'lastSuccessAt and lastFailureAt must be strings or null');
  }
  if (state.lastSuccessAt !== null) assertTimestamp(state.lastSuccessAt, `${path}.lastSuccessAt`);
  if (state.lastFailureAt !== null) assertTimestamp(state.lastFailureAt, `${path}.lastFailureAt`);
}

function assertConversation(value: unknown, path: string): asserts value is SignalConversation {
  const conversation = record(value, path);
  if (!nonemptyString(conversation.provider) || !nonemptyString(conversation.observedAt)) {
    fail(path, 'provider and observedAt are required');
  }
  assertTimestamp(conversation.observedAt, `${path}.observedAt`);
  if (!nonnegativeInteger(conversation.commentsReturned)) fail(path, 'commentsReturned must be a non-negative integer');
  if (!(conversation.commentsTotal === null || nonnegativeInteger(conversation.commentsTotal))) {
    fail(path, 'commentsTotal must be a non-negative integer or null');
  }
  if (typeof conversation.partial !== 'boolean') fail(path, 'partial must be boolean');
  if (!Array.isArray(conversation.participants)) fail(path, 'participants must be an array');
  if (conversation.participants.length > 10) fail(path, 'participants must contain no more than 10 items');
  conversation.participants.forEach((participant, index) => assertParticipant(participant, `${path}.participants[${index}]`));
}

function assertParticipant(value: unknown, path: string): asserts value is SignalConversationParticipant {
  const participant = record(value, path);
  requiredStringFields(participant, path, ['displayName', 'excerpt']);
  for (const field of ['handle', 'profileUrl', 'commentUrl', 'publishedAt']) {
    if (!nullableString(participant[field])) fail(path, `${field} must be a string or null`);
  }
  if (participant.profileUrl !== null) assertUrl(participant.profileUrl, `${path}.profileUrl`);
  if (participant.commentUrl !== null) assertUrl(participant.commentUrl, `${path}.commentUrl`);
  if (participant.publishedAt !== null) assertTimestamp(participant.publishedAt, `${path}.publishedAt`);
}

function record(value: unknown, path = 'response'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as Record<string, unknown>;
}

function requiredStringFields(value: Record<string, unknown>, path: string, fields: string[]): void {
  for (const field of fields) if (!nonemptyString(value[field])) fail(path, `${field} is required`);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function unitNumber(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function assertTimestamp(value: unknown, path: string): void {
  if (!nonemptyString(value) || !Number.isFinite(Date.parse(value))) fail(path, 'must be a valid timestamp');
}

function assertUrl(value: unknown, path: string): void {
  if (!nonemptyString(value)) fail(path, 'must be a URL');
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') fail(path, 'must use http or https');
  } catch (error) {
    if (error instanceof SourceFoundryContractError) throw error;
    fail(path, 'must be a valid URL');
  }
}

function nonnegativeInteger(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value) && value >= 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function fail(path: string, message: string): never {
  throw new SourceFoundryContractError(`${path}: ${message}`);
}
