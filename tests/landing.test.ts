import { describe, expect, it } from 'vitest';
import { landingPage } from '../src/landing.js';

describe('SourceFoundry landing page', () => {
  it('markets SourceFoundry and hands operation to the coding agent', () => {
    const page = landingPage('https://sourcefoundry.4agents.fyi');
    expect(page).toContain('https://sourcefoundry.4agents.fyi/llms.txt');
    expect(page).toContain('Give your agent a source feed that stays fresh.');
    expect(page).toContain('Copy the setup prompt');
    expect(page).toContain('Your agent creates a workspace');
    expect(page).toContain('SourceFoundry returns one API token');
    expect(page).toContain('only source items added since the previous read');
    expect(page).toContain('SOURCEFOUNDRY_API_TOKEN');
    expect(page).toContain('removes duplicate results, keeps the original links, and tells your coding agent what is new');
    expect(page).toContain('No dashboard. Your coding agent sets up and uses SourceFoundry.');
    expect(page).not.toContain('Feedline');
    expect(page).not.toContain('class="eyebrow"');
    expect(page).not.toContain('material');
    expect(page).toContain('build_source_feed · read_source_feed');
    expect(page).toContain('Search gives your agent a pile. SourceFoundry gives it a supply line.');
    expect(page).toContain('Give these instructions to your coding agent.');
    expect(page).toContain('Use our hosted service, or run SourceFoundry yourself.');
    expect(page).toContain('SourceFoundry is open source.');
    expect(page).toContain('MIT licensed. Read the code, run it on your infrastructure');
    expect(page).toContain('View code &amp; self-host');
    expect(page.match(/Star SourceFoundry(?: on GitHub)?/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain('docker compose up --build');
    expect(page).toContain('Tavily, Exa, or Serper');
    expect(page).toContain('https://github.com/ankaiinc/sourcefoundry');
    expect(page).toContain('<link rel="canonical" href="https://sourcefoundry.4agents.fyi/"');
    expect(page).toContain('<meta property="og:image" content="https://sourcefoundry.4agents.fyi/sourcefoundry-og.png"');
    expect(page).not.toContain('href="https://4agents.fyi"');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(page).toContain('application/ld+json');
    expect(page).not.toContain('id="enrollment"');

    const scripts = [...page.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
