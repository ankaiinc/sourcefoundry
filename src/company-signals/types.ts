/**
 * Company-scoped research signals for outbound. One input company produces one
 * CompanySignals record: the evidence behind it (each with a canonical URL and
 * provenance, in the same shape as the /v1/signals contract fields) plus a
 * derived summary a downstream writer can choose an angle from.
 *
 * Deliberately company-only: no people, no emails, no contact enrichment.
 */

export type AtsProvider = 'greenhouse' | 'ashby' | 'lever' | 'workable' | 'recruitee';
export const ATS_PROVIDERS: readonly AtsProvider[] = ['greenhouse', 'ashby', 'lever', 'workable', 'recruitee'];

export interface CompanyInput {
  name: string;
  domain: string;
  ats?: { provider: AtsProvider; slug: string };
}

export interface AtsJob {
  id: string;
  title: string;
  url: string;
  location: string | null;
  postedAt: string | null;
  /** Plain-text description, when the provider exposes one. */
  text: string | null;
}

export interface AtsBoard {
  provider: AtsProvider;
  slug: string;
  /** Display name the provider reports for the board, when it reports one. */
  boardName: string | null;
  jobs: AtsJob[];
}

/** How we know an ATS board belongs to this company and not a namesake. */
export type VerificationMethod =
  | 'hint'          // caller supplied provider + slug
  | 'site_link'     // the company's own website links to this board
  | 'domain'        // postings mention the company's domain
  | 'board_name'    // the provider's board name equals the company name
  | 'name_in_postings';

export interface ResolvedAts {
  provider: AtsProvider;
  slug: string;
  verified: boolean;
  method: VerificationMethod | null;
  /** Why a candidate board was rejected, when it was. */
  rejected?: string;
}

export interface HiringSignal {
  title: string;
  url: string;
  posted_at: string | null;
  infra_role: boolean;
  stack_terms: string[];
  cost_terms: string[];
  quote: string | null;
}

export interface Stack {
  clouds: string[];
  kubernetes: boolean;
  iac: string[];
  data: string[];
  gpu: boolean;
}

export interface DatedLink { title: string; url: string; date: string | null }
export interface WritingSignal extends DatedLink { quote: string | null }

export type EvidenceStrength = 'strong' | 'medium' | 'weak' | 'none';

/** One piece of evidence, carrying the provenance fields of the /v1/signals contract. */
export interface EvidenceRecord {
  kind: 'hiring' | 'incident' | 'writing' | 'site';
  title: string;
  url: string;
  canonicalUrl: string;
  provider: string;
  reliability: number;
  fetchedAt: string;
  publishedAt: string | null;
  completeness: { title: boolean; summary: boolean; publishedAt: boolean };
}

export interface CostEntry {
  provider: string;
  queries: number;
  /** Estimated from published list prices; not read from a bill. */
  estimated_usd: number;
}

export interface CompanySignals {
  schema: 'company_signals/v1';
  name: string;
  domain: string;
  resolved_ats: ResolvedAts | null;
  hiring: HiringSignal[];
  stack: Stack;
  regulated: string[];
  regions: string[];
  incidents: DatedLink[];
  public_writing: WritingSignal[];
  evidence_strength: EvidenceStrength;
  evidence: EvidenceRecord[];
  /** Sources that were tried and failed; a failure is never reported as "no signal". */
  errors: Array<{ source: string; error: string }>;
  costs: CostEntry[];
  fetched_at: string;
}
