import { sha256 } from './hash.js';
import type { PublicSignal, SignalObservation } from './types.js';

const MAX_OBSERVATIONS_PER_SIGNAL = 3;

function normalizedTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
export function signalKeyFor(signal: Pick<PublicSignal, 'tenantId' | 'title' | 'provenance'>): string {
  const title = normalizedTitle(signal.title);
  const identity = title.length >= 12 ? `title:${title}` : `url:${signal.provenance.canonicalUrl}`;
  return `sig_${sha256(`${signal.tenantId}:${identity}`).slice(0, 24)}`;
}

function observation(signal: PublicSignal): SignalObservation {
  return {
    candidateId: signal.id,
    title: signal.title,
    summary: signal.summary,
    url: signal.url,
    score: signal.score,
    generatedAt: signal.generatedAt,
    publishedAt: signal.publishedAt,
    source: signal.source,
    provenance: signal.provenance,
    freshness: signal.freshness,
    completeness: signal.completeness,
    failureState: signal.failureState,
  };
}

function stronger(left: PublicSignal, right: PublicSignal): PublicSignal {
  if (left.score !== right.score) return left.score > right.score ? left : right;
  if (left.source.reliability !== right.source.reliability) {
    return left.source.reliability > right.source.reliability ? left : right;
  }
  return left.generatedAt >= right.generatedAt ? left : right;
}

/**
 * Builds a bounded evidence bundle without allowing repetition to manufacture
 * confidence. A source contributes at most once, and additional observations
 * never raise the representative candidate score.
 */
export function aggregatePublicSignals(signals: PublicSignal[], limit: number): PublicSignal[] {
  const groups = new Map<string, PublicSignal[]>();
  for (const signal of signals) {
    const key = signalKeyFor(signal);
    const group = groups.get(key) ?? [];
    group.push(signal);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([signalKey, group]) => {
      const perSource = new Map<string, PublicSignal>();
      for (const candidate of group) {
        const current = perSource.get(candidate.source.id);
        perSource.set(candidate.source.id, current ? stronger(current, candidate) : candidate);
      }
      const independent = [...perSource.values()].sort((left, right) =>
        right.score - left.score ||
        right.source.reliability - left.source.reliability ||
        right.generatedAt.localeCompare(left.generatedAt) ||
        left.id.localeCompare(right.id));
      const representative = independent[0]!;
      const selected = independent.slice(0, MAX_OBSERVATIONS_PER_SIGNAL);
      return {
        ...representative,
        aggregation: {
          signalKey,
          observationCount: selected.length,
          sourceCount: perSource.size,
          capped: group.length > selected.length,
        },
        observations: selected.map(observation),
      } satisfies PublicSignal;
    })
    .sort((left, right) =>
      right.score - left.score ||
      right.generatedAt.localeCompare(left.generatedAt) ||
      left.aggregation.signalKey.localeCompare(right.aggregation.signalKey))
    .slice(0, Math.max(0, limit));
}
