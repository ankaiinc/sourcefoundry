import { describe, expect, it } from 'vitest';
import { landingPage } from '../src/landing.js';

describe('SourceFoundry landing page', () => {
  it('markets Feedline and hands operation to the coding agent', () => {
    const page = landingPage('https://sources.4agents.fyi');
    expect(page).toContain('https://sources.4agents.fyi/llms.txt');
    expect(page).toContain('SOURCEFOUNDRY_API_TOKEN');
    expect(page).toContain('Your agent makes the product.');
    expect(page).toContain('Feedline keeps it supplied');
    expect(page).toContain('No dashboard. Your coding agent operates the service.');
    expect(page).toContain('The Feedline Trap');
    expect(page).toContain('build_source_feed · read_source_feed');
    expect(page).toContain('Search gives your agent a pile. Feedline gives it a supply line.');
    expect(page).toContain('Hand the line to your coding agent.');
    expect(page).toContain('docker compose up --build');
    expect(page).toContain('Tavily, Exa, or Serper');
    expect(page).toContain('https://github.com/ankaiinc/sourcefoundry');
    expect(page).not.toContain('id="enrollment"');

    const scripts = [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
