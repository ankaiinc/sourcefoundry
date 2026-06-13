import type { SignalSource, SourceEntry } from './types.js';

const DEFAULT_RELEVANCE_TERMS = [
  'leadership',
  'management',
  'strategy',
  'product',
  'engineering',
  'manager',
  'decision',
  'execution',
  'customer',
  'team',
  'ai',
  'startup',
  'growth',
];

export interface ScoredEntry {
  relevanceScore: number;
  candidateScore: number;
  tags: string[];
}

export function scoreEntry(entry: SourceEntry, source: SignalSource): ScoredEntry {
  const text = `${entry.title}\n${entry.summary}`.toLowerCase();
  const configuredTerms = Array.isArray(source.metadata.relevance_terms)
    ? source.metadata.relevance_terms.filter((term): term is string => typeof term === 'string')
    : [];
  const terms = configuredTerms.length > 0 ? configuredTerms : DEFAULT_RELEVANCE_TERMS;

  const matched = terms.filter((term) => text.includes(term.toLowerCase()));
  const relevanceScore = clamp(matched.length / Math.min(5, terms.length || 1));
  const freshnessScore = freshness(entry.publishedAt);
  const candidateScore = clamp(
    relevanceScore * 0.5 + source.reliability * 0.3 + freshnessScore * 0.2,
  );

  return {
    relevanceScore,
    candidateScore,
    tags: matched.slice(0, 6).map((tag) => tag.toLowerCase()),
  };
}

function freshness(publishedAt: string | null): number {
  if (!publishedAt) return 0.45;
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return 0.45;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  if (ageHours <= 24) return 1;
  if (ageHours <= 72) return 0.8;
  if (ageHours <= 168) return 0.6;
  if (ageHours <= 720) return 0.35;
  return 0.15;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
