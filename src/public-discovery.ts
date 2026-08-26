export function robotsTxt(baseUrl: string): string {
  return `User-agent: *
Allow: /
Disallow: /v1/
Disallow: /health
Disallow: /ready

Sitemap: ${baseUrl}/sitemap.xml
`;
}

export function sitemapXml(baseUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(`${baseUrl}/`)}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]!);
}
