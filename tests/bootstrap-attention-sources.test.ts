import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/bootstrap-attention-sources.mjs', import.meta.url));

function dryRun(...args: string[]): Record<string, unknown> {
  return JSON.parse(execFileSync(process.execPath, [script, '--dry-run', ...args], {
    encoding: 'utf8',
    env: { ...process.env, SOURCEFOUNDRY_API_TOKEN: 'must-not-appear' },
  })) as Record<string, unknown>;
}

describe('Attention source bootstrap plan', () => {
  it('defaults to the bounded Tavily plan without a network mutation', () => {
    const plan = dryRun();
    expect(plan).toMatchObject({
      dryRun: true,
      mutationPerformed: false,
      providerPlan: { linkedin: 'tavily', x: 'tavily', youtube: 'tavily', officialProviderRequirements: [] },
      nextCommand: 'npm run bootstrap:attention -- --confirm=create-attention-sources',
    });
    expect((plan.sources as Array<{ metadata: { provider: string } }>).map((source) => source.metadata.provider))
      .toEqual(['tavily', 'tavily', 'tavily']);
    expect(JSON.stringify(plan)).not.toContain('must-not-appear');
  });

  it('previews official X and YouTube reads while naming secrets but never their values', () => {
    const plan = dryRun('--x-provider=official', '--youtube-provider=official');
    expect(plan).toMatchObject({
      mutationPerformed: false,
      providerPlan: {
        linkedin: 'tavily',
        x: 'official',
        youtube: 'official',
        officialProviderRequirements: [
          { platform: 'x', workerEnvironmentVariable: 'X_API_BEARER_TOKEN' },
          { platform: 'youtube', workerEnvironmentVariable: 'YOUTUBE_API_KEY' },
        ],
      },
      nextCommand: 'npm run bootstrap:attention -- --confirm=create-attention-sources --x-provider=official --youtube-provider=official --confirm-worker-provider-secrets-configured',
    });
    const sources = plan.sources as Array<{ url: string; metadata: { provider: string; max_results_per_query: number } }>;
    expect(sources.map((source) => source.metadata.provider)).toEqual(['tavily', 'x', 'youtube']);
    expect(sources[1]?.url).toContain('/tweets/search/recent');
    expect(sources[1]?.metadata.max_results_per_query).toBe(10);
    expect(sources[2]?.url).toContain('/youtube/v3/search');
    expect(JSON.stringify(plan)).not.toContain('must-not-appear');
  });

  it('rejects unknown provider choices before any request', () => {
    const result = spawnSync(process.execPath, [script, '--dry-run', '--x-provider=scraper'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('x-provider must be tavily or official');
  });

  it('requires an explicit worker-secret acknowledgement before creating official sources', () => {
    const result = spawnSync(process.execPath, [
      script,
      '--confirm=create-attention-sources',
      '--x-provider=official',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SOURCEFOUNDRY_BASE_URL: 'https://sourcefoundry.invalid',
        SOURCEFOUNDRY_API_TOKEN: 'must-not-appear',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--confirm-worker-provider-secrets-configured');
    expect(result.stderr).not.toContain('must-not-appear');
  });
});
