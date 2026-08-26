import { describe, expect, it } from 'vitest';
import { robotsTxt, sitemapXml } from '../src/public-discovery.js';

describe('public discovery files', () => {
  const baseUrl = 'https://sourcefoundry.4agents.fyi';

  it('publishes an intentional robots policy and canonical sitemap', () => {
    const robots = robotsTxt(baseUrl);
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /v1/');
    expect(robots).toContain(`Sitemap: ${baseUrl}/sitemap.xml`);
  });

  it('publishes only the canonical public homepage', () => {
    const sitemap = sitemapXml(baseUrl);
    expect(sitemap).toContain(`<loc>${baseUrl}/</loc>`);
    expect(sitemap).not.toContain('/v1/');
  });
});
