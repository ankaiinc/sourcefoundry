export const DEFAULT_SOURCEFOUNDRY_BASE: string;

export function buildSourceFeed(options: {
  sourceFeed: Record<string, unknown>;
  apiToken?: string;
  base?: string;
  idempotencyKey?: string;
  runNow?: boolean;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<Record<string, any>>;

export function readSourceFeed(options: {
  sourceFeedId: string;
  since?: string;
  limit?: number;
  statuses?: string[];
  includeHealth?: boolean;
  apiToken?: string;
  base?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<Record<string, any>>;

export class SourceFoundryClientError extends Error {
  status: number;
  body: unknown;
}
