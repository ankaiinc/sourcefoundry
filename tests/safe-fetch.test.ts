import { describe, expect, it } from 'vitest';
import { responseStatusAllowsBody } from '../src/safe-fetch.js';

describe('safeFetch response status handling', () => {
  it('does not attach a body to HTTP statuses that forbid one', () => {
    expect(responseStatusAllowsBody(204)).toBe(false);
    expect(responseStatusAllowsBody(205)).toBe(false);
    expect(responseStatusAllowsBody(304)).toBe(false);
  });

  it('preserves response bodies for ordinary success and error statuses', () => {
    expect(responseStatusAllowsBody(200)).toBe(true);
    expect(responseStatusAllowsBody(400)).toBe(true);
    expect(responseStatusAllowsBody(500)).toBe(true);
  });
});
