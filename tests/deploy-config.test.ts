import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('hosted database trust configuration', () => {
  it('ships and selects the pinned Supabase root certificate for every Fly process', () => {
    const certificate = new X509Certificate(readFileSync('certs/supabase-prod-ca-2021.crt'));
    const dockerfile = readFileSync('Dockerfile', 'utf8');
    const flyConfig = readFileSync('fly.toml', 'utf8');

    expect(certificate.subject).toContain('CN=Supabase Root 2021 CA');
    expect(certificate.fingerprint256).toBe('80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
    expect(Date.parse(certificate.validTo)).toBeGreaterThan(Date.parse('2031-04-25T00:00:00Z'));
    expect(dockerfile).toContain('COPY --chown=node:node certs ./certs');
    expect(flyConfig).toContain('SOURCEFOUNDRY_DATABASE_CA_FILE = "/app/certs/supabase-prod-ca-2021.crt"');
  });
});
