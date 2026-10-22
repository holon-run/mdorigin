import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeContentDate, normalizePageRobots, normalizeSiteRobots, serializePageRobots } from './seo.js';
import { parseDocumentMeta, renderMarkdownWithHeadings } from './markdown.js';

test('content dates accept real ISO dates and zoned timestamps, never deployment time', () => {
  assert.equal(normalizeContentDate('2024-02-29'), '2024-02-29');
  assert.equal(normalizeContentDate('2026-10-21T15:30:00+08:00'), '2026-10-21T07:30:00.000Z');
  for (const invalid of ['2025-02-29', '2026-13-01', 'yesterday', '2026-10-21T12:00:00', '', 123, undefined]) {
    assert.equal(normalizeContentDate(invalid), undefined);
  }
  const { meta } = parseDocumentMeta('post.md', [
    '---', 'date: 2026-01-01', 'updated: "2026-02-30"', 'author: [Alice, Bob]', '---', '# Post',
  ].join('\n'));
  assert.equal(meta.date, '2026-01-01');
  assert.equal(meta.updated, undefined);
  assert.deepEqual(meta.author, ['Alice', 'Bob']);
  for (const invalid of ['2026-02-30', '2025-02-29', '2026-10-21T25:00:00Z']) {
    const bare = parseDocumentMeta('post.md', `---\ndate: 2026-01-01\nupdated: ${invalid}\n---\nBody`);
    assert.equal(bare.meta.updated, undefined, invalid);
    assert.equal(bare.meta.date, '2026-01-01');
  }
});

test('robots normalization uses a finite directive vocabulary and rejects header injection', () => {
  const value = normalizePageRobots('noindex, follow, max-snippet:120, max-image-preview:large, max-video-preview:-1');
  assert.equal(serializePageRobots(value), 'noindex, follow, max-snippet:120, max-image-preview:large, max-video-preview:-1');
  assert.equal(normalizePageRobots('noindex\r\nX-Injected: yes'), undefined);
  assert.equal(normalizePageRobots({ maxSnippet: -2, maxVideoPreview: Infinity, maxImagePreview: 'all' }), undefined);
  assert.deepEqual(normalizeSiteRobots({ rules: [
    { userAgent: 'GPTBot', disallow: ['/', '/safe\nUser-agent: *'] },
    { userAgent: '*\nDisallow: /' },
  ] }), { rules: [{ userAgent: 'GPTBot', allow: [], disallow: ['/'] }] });
  assert.equal(parseDocumentMeta('post.md', '---\nnoindex: true\nrobots: follow\n---\nBody').meta.robots?.index, false);
});

test('heading IDs are deterministic, multilingual, inline-aware, and collision-free', async () => {
  const markdown = [
    '# Hello `world`', '', '## 中文 标题', '', '## Repeat', '', '## Repeat',
    '', '<h2 id="repeat-1">Explicit</h2>', '', '<h2 id="repeat-1">Duplicate explicit</h2>',
    '', '## **Repeat**', '', '## !!!',
    '', '## Hello<!-- mdorigin:foo --> World',
  ].join('\n');
  const first = await renderMarkdownWithHeadings(markdown);
  assert.deepEqual(first, await renderMarkdownWithHeadings(markdown));
  const ids = Array.from(first.html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.deepEqual(ids, ['hello-world', '中文-标题', 'repeat', 'repeat-2', 'repeat-1', 'repeat-1-1', 'repeat-3', 'section', 'hello-world-1']);
  assert.ok(first.headings.every((heading) => first.html.includes(`id="${heading.id}"`)));
  assert.equal(first.headings.find((heading) => heading.id === 'repeat-2')?.charStart, markdown.indexOf('## Repeat', markdown.indexOf('## Repeat') + 1));
});
