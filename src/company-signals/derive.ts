import type { AtsJob, DatedLink, EvidenceStrength, HiringSignal, Stack, WritingSignal } from './types.js';

/** Term dictionaries. Each entry is [label, pattern]; labels are what the summary reports. */
type Terms = ReadonlyArray<readonly [string, RegExp]>;

export const CLOUD_TERMS: Terms = [
  ['aws', /\b(aws|amazon web services|ec2|eks|lambda functions?|s3 buckets?)\b/i],
  ['gcp', /\b(gcp|google cloud|gke|bigquery)\b/i],
  ['azure', /\b(azure|aks)\b/i],
];
export const IAC_TERMS: Terms = [
  ['terraform', /\bterraform\b/i],
  ['pulumi', /\bpulumi\b/i],
  ['opentofu', /\bopen ?tofu\b/i],
];
export const DATA_TERMS: Terms = [
  ['databricks', /\bdatabricks\b/i],
  ['snowflake', /\bsnowflake\b/i],
];
const KUBERNETES = /\b(kubernetes|k8s|eks|gke|aks|helm)\b/i;
const GPU = /\b(gpus?|cuda|h100s?|a100s?|inference clusters?)\b/i;

export const COST_TERMS: Terms = [
  ['finops', /\bfinops\b/i],
  ['cloud cost', /\bcloud (costs?|spend|bills?)\b/i],
  ['cost optimisation', /\bcost[- ]?(optimi[sz]\w*|efficien\w*|reduction|savings?|controls?|governance|visibility|management)\b/i],
  ['reduce spend', /\breduc\w* (?:our |the )?(?:cloud |infrastructure |infra |compute |aws |gpu )?(?:costs?|spend)\b/i],
  ['rightsizing', /\bright[- ]?siz\w*\b/i],
  ['spot / reserved', /\b(spot instances?|reserved instances?|savings plans?)\b/i],
];

export const REGULATED_TERMS: Terms = [
  ['soc2', /\bsoc ?(2|ii)\b/i],
  ['hipaa', /\bhipaa\b/i],
  ['pci', /\bpci(?:[- ]dss)?\b/i],
  ['iso27001', /\biso ?27001\b/i],
  ['gdpr', /\bgdpr\b/i],
  ['fedramp', /\bfedramp\b/i],
  ['hitrust', /\bhitrust\b/i],
  ['rbi', /\b(rbi|reserve bank of india)\b/i],
];

const INFRA_TITLE = /\b(platform|infrastructure|infra|devops|dev ops|sre|site reliability|cloud|devsecops|finops|reliability|kubernetes|production engineer|systems engineer|ml ?ops|data platform)\b/i;
const REGION_CODE = /\b(us|eu|ap|sa|ca|me|af|il)-(east|west|central|south|north|northeast|southeast|northwest|southwest)-\d\b/gi;
const MULTI_REGION = /\b(multi[- ]region|multi[- ]cloud|global(ly)? distributed|data residency)\b/i;

const LOOKBACK_INCIDENT_DAYS = 90;
const LOOKBACK_WRITING_DAYS = 365;

export function matchTerms(text: string, terms: Terms): string[] {
  return terms.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

export function isInfraRole(title: string): boolean {
  return INFRA_TITLE.test(title);
}

/** One sentence around the first match, so a writer can quote it next to the URL. */
export function quoteFor(text: string, patterns: RegExp[], maxChars = 240): string | null {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const pattern of patterns) {
    const sentence = sentences.find((s) => pattern.test(s));
    if (sentence) return sentence.length > maxChars ? `${sentence.slice(0, maxChars - 1).trimEnd()}…` : sentence;
  }
  return null;
}

function stackTermsOf(text: string): string[] {
  const terms = [...matchTerms(text, CLOUD_TERMS), ...matchTerms(text, IAC_TERMS), ...matchTerms(text, DATA_TERMS)];
  if (KUBERNETES.test(text)) terms.push('kubernetes');
  if (GPU.test(text)) terms.push('gpu');
  return terms;
}

export function hiringSignal(job: AtsJob): HiringSignal {
  const text = `${job.title}\n${job.text ?? ''}`;
  const cost = matchTerms(text, COST_TERMS);
  const stack = stackTermsOf(text);
  const quotePatterns = cost.length
    ? COST_TERMS.filter(([l]) => cost.includes(l)).map(([, p]) => p)
    : [...IAC_TERMS, ...CLOUD_TERMS].map(([, p]) => p).concat(KUBERNETES);
  return {
    title: job.title,
    url: job.url,
    posted_at: job.postedAt,
    infra_role: isInfraRole(job.title),
    stack_terms: stack,
    cost_terms: cost,
    quote: job.text ? quoteFor(job.text, quotePatterns) : null,
  };
}

/** Infra roles first, then roles that mention cost, then stack; capped so records stay small. */
export function rankHiring(signals: HiringSignal[], limit = 15): HiringSignal[] {
  const weight = (h: HiringSignal) => (h.infra_role ? 4 : 0) + (h.cost_terms.length ? 2 : 0) + (h.stack_terms.length ? 1 : 0);
  return [...signals].sort((a, b) => weight(b) - weight(a) || (b.posted_at ?? '').localeCompare(a.posted_at ?? '')).slice(0, limit);
}

export function deriveStack(texts: string[]): Stack {
  const all = texts.join('\n');
  return {
    clouds: matchTerms(all, CLOUD_TERMS),
    kubernetes: KUBERNETES.test(all),
    iac: matchTerms(all, IAC_TERMS),
    data: matchTerms(all, DATA_TERMS),
    gpu: GPU.test(all),
  };
}

export function deriveRegions(texts: string[]): string[] {
  const all = texts.join('\n');
  const codes = new Set([...all.matchAll(REGION_CODE)].map((m) => m[0].toLowerCase()));
  if (MULTI_REGION.test(all)) codes.add('multi-region');
  return [...codes].sort();
}

const withinDays = (date: string | null, days: number, now: Date) =>
  !!date && now.getTime() - Date.parse(date) <= days * 86_400_000;

export function recentIncidents(incidents: DatedLink[], now: Date): DatedLink[] {
  return incidents.filter((i) => withinDays(i.date, LOOKBACK_INCIDENT_DAYS, now));
}

export function relevantWriting(items: Array<{ title: string; url: string; date: string | null; text: string }>, now: Date): WritingSignal[] {
  const patterns = [...COST_TERMS, ...IAC_TERMS, ...CLOUD_TERMS].map(([, p]) => p).concat(KUBERNETES, GPU, /\b(scal(e|ing)|infrastructure|latency|outage)\b/i);
  return items
    .filter((item) => !item.date || withinDays(item.date, LOOKBACK_WRITING_DAYS, now))
    .map((item) => ({ ...item, quote: quoteFor(`${item.title}. ${item.text}`, patterns) }))
    .filter((item) => item.quote !== null)
    .map(({ title, url, date, quote }) => ({ title, url, date, quote }));
}

const mentionsCost = (text: string | null) => !!text && COST_TERMS.some(([, p]) => p.test(text));

/**
 * strong: something a cold email can quote that is about cost — a verified
 *   infra role asking for cost work, or the company writing about cost.
 * medium: a verified infra hire, a recent outage on a known stack, or the
 *   company writing about infra/scale.
 * weak: we know something true (an open board, a stack, a compliance regime)
 *   but nothing that ties to cloud pain.
 * none: nothing verified.
 */
export function evidenceStrength(input: { hiring: HiringSignal[]; stack: Stack; regulated: string[]; incidents: DatedLink[]; writing: WritingSignal[]; boardVerified: boolean }): EvidenceStrength {
  const hiring = input.boardVerified ? input.hiring : [];
  const hasStack = input.stack.clouds.length > 0 || input.stack.kubernetes || input.stack.iac.length > 0 || input.stack.data.length > 0 || input.stack.gpu;
  if (hiring.some((h) => h.infra_role && h.cost_terms.length) || input.writing.some((w) => mentionsCost(w.quote))) return 'strong';
  if (hiring.some((h) => h.infra_role || h.cost_terms.length) || (input.incidents.length && hasStack) || input.writing.length) return 'medium';
  if (hiring.length || hasStack || input.regulated.length || input.incidents.length) return 'weak';
  return 'none';
}
