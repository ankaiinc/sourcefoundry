import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/ingest/rss.js';

describe('parseFeed', () => {
  it('parses RSS entries and canonicalizes tracking URLs', () => {
    const entries = parseFeed(
      `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title><![CDATA[Product leadership decision]]></title>
          <link>https://www.example.com/post?utm_source=x&amp;b=2&amp;a=1</link>
          <description><![CDATA[How a product team made a hard execution call.]]></description>
          <pubDate>Sat, 13 Jun 2026 10:00:00 GMT</pubDate>
          <guid>abc</guid>
        </item>
      </channel></rss>`,
      'https://feeds.example.com/rss',
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('Product leadership decision');
    expect(entries[0]?.canonicalUrl).toBe('https://example.com/post?a=1&b=2');
    expect(entries[0]?.publishedAt).toBe('2026-06-13T10:00:00.000Z');
  });

  it('parses Atom links from href attributes', () => {
    const entries = parseFeed(
      `<feed>
        <entry>
          <title>Engineering management lessons</title>
          <link href="/article"/>
          <summary>Team decision quality.</summary>
          <updated>2026-06-13T10:00:00Z</updated>
        </entry>
      </feed>`,
      'https://example.com/feed',
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toBe('https://example.com/article');
  });
});
