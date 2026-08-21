import { describe, expect, it } from 'vitest';
import { landingPage } from '../src/landing.js';

describe('SourceFoundry landing page', () => {
  it('offers a direct autonomous enrollment path on the canonical domain', () => {
    const page = landingPage('https://sources.4agents.fyi');
    expect(page).toContain('/v1/agent-enrollments');
    expect(page).toContain('SOURCEFOUNDRY_API_TOKEN');
    expect(page).toContain('Your sources.<br>One evidence API.');
    expect(page).toContain('Evidence capacity');
    expect(page).toContain('Product of <a href="https://4agents.fyi">4agents.fyi</a>');
  });
});
