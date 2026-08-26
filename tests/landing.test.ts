import { describe, expect, it } from 'vitest';
import { landingPage } from '../src/landing.js';

describe('SourceFoundry landing page', () => {
  it('markets Feedline and hands operation to the coding agent', () => {
    const page = landingPage('https://sources.4agents.fyi');
    expect(page).toContain('https://sources.4agents.fyi/llms.txt');
    expect(page).toContain('SOURCEFOUNDRY_API_TOKEN');
    expect(page).toContain('Give your agent a source feed that stays fresh.');
    expect(page).toContain('removes duplicate results, keeps the original links, and reports source failures');
    expect(page).toContain('No dashboard. Your coding agent operates Feedline.');
    expect(page).not.toContain('The Feedline Trap');
    expect(page).not.toContain('class="eyebrow"');
    expect(page).not.toContain('material');
    expect(page).toContain('build_source_feed · read_source_feed');
    expect(page).toContain('Search gives your agent a pile. Feedline gives it a supply line.');
    expect(page).toContain('Connect Feedline to your coding agent.');
    expect(page).toContain('Use our hosted service, or run Feedline yourself.');
    expect(page).toContain('docker compose up --build');
    expect(page).toContain('Tavily, Exa, or Serper');
    expect(page).toContain('https://github.com/ankaiinc/sourcefoundry');
    expect(page).not.toContain('id="enrollment"');

    const scripts = [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
