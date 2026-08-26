import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const markdownFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/operations.md',
  'docs/provider-keys.md',
  'docs/public-agent-service-v0.md',
  'docs/public-source-supply-v0.md',
  'docs/self-hosting.md',
  'mcp/README.md',
];

describe('public documentation links', () => {
  it('keeps every repository-relative Markdown link resolvable', () => {
    const missing: string[] = [];

    for (const file of markdownFiles) {
      const markdown = readFileSync(resolve(file), 'utf8');
      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1]!.trim();
        if (!target || target.startsWith('#') || /^[a-z]+:/i.test(target)) continue;
        const relativePath = decodeURIComponent(target.split('#')[0]!);
        if (!existsSync(resolve(dirname(file), relativePath))) missing.push(`${file} -> ${target}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
