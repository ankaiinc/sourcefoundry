import { createHash, randomBytes } from 'node:crypto';
import type { JsonRecord } from './types.js';

export interface AgentSourcePolicy {
  minIntervalMinutes: number;
  maxItemsPerFetch: number;
}

export function createAgentToken(): string {
  return `sfa_${randomBytes(32).toString('base64url')}`;
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function validateAgentSourcePolicy(input: {
  sourceType: 'rss' | 'atom' | 'web';
  url: string;
  intervalMinutes: number;
  maxItemsPerFetch: number;
  metadata: JsonRecord;
}, policy: AgentSourcePolicy): void {
  if (input.intervalMinutes < policy.minIntervalMinutes) {
    throw new Error(`intervalMinutes must be at least ${policy.minIntervalMinutes} for an autonomous agent workspace`);
  }
  if (input.maxItemsPerFetch > policy.maxItemsPerFetch) {
    throw new Error(`maxItemsPerFetch must be at most ${policy.maxItemsPerFetch} for an autonomous agent workspace`);
  }
  validatePublicHttpsUrl(input.url);
  if (input.sourceType === 'web') {
    const provider = input.metadata.provider;
    if (provider !== 'tavily' && provider !== 'exa' && provider !== 'serper') {
      throw new Error('autonomous web discovery supports tavily, exa, or serper only');
    }
  }
  if (containsCredentialField(input.metadata)) {
    throw new Error('provider credentials, cookies, and tokens are not allowed in agent source metadata');
  }
}

function validatePublicHttpsUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('source URL must be an absolute HTTPS URL');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('source URL must be a public HTTPS URL');
  }
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host) || host === '::1') {
    throw new Error('source URL must not target a private network address');
  }
}

function containsCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /(api[_-]?key|token|secret|password|cookie|authorization)/i.test(key) || containsCredentialField(child),
  );
}
