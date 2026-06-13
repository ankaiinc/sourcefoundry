export function canonicalizeUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    url.hash = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    for (const key of Array.from(url.searchParams.keys())) {
      if (isTrackingParam(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();

    const rendered = url.toString();
    return rendered.endsWith('/') && url.pathname === '/' ? rendered.slice(0, -1) : rendered;
  } catch {
    return input.trim();
  }
}

function isTrackingParam(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.startsWith('utm_') ||
    normalized === 'fbclid' ||
    normalized === 'gclid' ||
    normalized === 'mc_cid' ||
    normalized === 'mc_eid'
  );
}
