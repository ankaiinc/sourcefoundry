import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
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

export function validatePublicHttpsUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('source URL must be an absolute HTTPS URL');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('source URL must be a public HTTPS URL');
  }
  if (isForbiddenAddress(host)) {
    throw new Error('source URL must not target a private network address');
  }
}

export function isForbiddenAddress(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(normalized);
  if (family === 4) return isForbiddenIpv4(normalized);
  if (family === 6) return isForbiddenIpv6(normalized);
  return false;
}

function isForbiddenIpv4(value: string): boolean {
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0)
    || a >= 224;
}

function isForbiddenIpv6(value: string): boolean {
  const expanded = expandIpv6(value);
  if (!expanded) return true;
  const address = expanded.reduce((result, part) => (result << 16n) + BigInt(part), 0n);
  const first = expanded[0]!;
  const second = expanded[1]!;
  const mappedIpv4 = (address >> 32n) === 0xffffn;
  if (mappedIpv4) {
    const ipv4 = [
      Number((address >> 24n) & 0xffn),
      Number((address >> 16n) & 0xffn),
      Number((address >> 8n) & 0xffn),
      Number(address & 0xffn),
    ].join('.');
    return isForbiddenIpv4(ipv4);
  }
  return address === 0n
    || address === 1n
    || (first & 0xfe00) === 0xfc00 // Unique-local fc00::/7
    || (first & 0xffc0) === 0xfe80 // Link-local fe80::/10
    || (first & 0xff00) === 0xff00 // Multicast ff00::/8
    || (first === 0x2001 && second === 0x0db8); // Documentation range
}

function expandIpv6(value: string): number[] | null {
  const input = value.toLowerCase();
  if (input.includes('.')) return null;
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const parts = [...left, ...right];
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if (halves.length === 1 && parts.length !== 8) return null;
  if (halves.length === 2 && parts.length >= 8) return null;
  const zeroes = 8 - parts.length;
  return [...left, ...Array(zeroes).fill('0'), ...right].map((part) => Number.parseInt(part, 16));
}

function containsCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /(api[_-]?key|token|secret|password|cookie|authorization)/i.test(key) || containsCredentialField(child),
  );
}
