import type { JsonRecord, SignalConversation, SignalConversationParticipant } from './types.js';

export function conversationFromPayload(value: unknown): SignalConversation | undefined {
  const payload = objectValue(value);
  const direct = objectValue(payload.conversation);
  const enriched = objectValue(objectValue(payload.enrichment).conversation);
  const candidate = Object.keys(enriched).length > 0 ? enriched : direct;
  if (Object.keys(candidate).length === 0) return undefined;

  const provider = stringValue(candidate.provider);
  const observedAt = dateValue(candidate.observedAt);
  const commentsReturned = nonnegativeInt(candidate.commentsReturned);
  const commentsTotal = nullableNonnegativeInt(candidate.commentsTotal);
  if (!provider || !observedAt || commentsReturned === null || typeof candidate.partial !== 'boolean') return undefined;
  const normalizedCommentsTotal = commentsTotal === null ? null : Math.max(commentsTotal, commentsReturned);

  const participants = Array.isArray(candidate.participants)
    ? candidate.participants.flatMap(parseParticipant).slice(0, 10)
    : [];
  return {
    provider,
    observedAt,
    commentsReturned,
    commentsTotal: normalizedCommentsTotal,
    partial: candidate.partial || (normalizedCommentsTotal !== null && commentsReturned < normalizedCommentsTotal),
    participants,
  };
}

function parseParticipant(value: unknown): SignalConversationParticipant[] {
  const participant = objectValue(value);
  const displayName = stringValue(participant.displayName);
  const excerpt = stringValue(participant.excerpt);
  if (!displayName || !excerpt) return [];
  return [{
    displayName,
    handle: nullableString(participant.handle),
    profileUrl: nullableUrl(participant.profileUrl),
    commentUrl: nullableUrl(participant.commentUrl),
    excerpt: excerpt.slice(0, 500),
    publishedAt: nullableDate(participant.publishedAt),
  }];
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(value: unknown): string | null {
  return stringValue(value) || null;
}

function nullableUrl(value: unknown): string | null {
  const input = stringValue(value);
  if (!input) return null;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function dateValue(value: unknown): string {
  const input = stringValue(value);
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function nullableDate(value: unknown): string | null {
  return dateValue(value) || null;
}

function nonnegativeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function nullableNonnegativeInt(value: unknown): number | null {
  return value === null || value === undefined ? null : nonnegativeInt(value);
}
