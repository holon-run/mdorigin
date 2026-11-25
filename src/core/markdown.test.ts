import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEntryDocumentMeta,
  parseMarkdownDocument,
  renderMarkdown,
  rewriteMarkdownLinksInHtml,
} from './markdown.js';
import { createExternalAssetUrlResolver } from './asset-urls.js';

test('parseEntryDocumentMeta memoizes metadata by entry identity', () => {
  const entry = {
    path: 'posts/example.md',
    kind: 'text' as const,
    mediaType: 'text/markdown; charset=utf-8',
    text: '---\ntitle: Example\ndraft: false\n---\n\n# Example\n',
  };

  const first = parseEntryDocumentMeta(entry);
  const second = parseEntryDocumentMeta(entry);

  assert.equal(first, second);
  assert.equal(first.meta.title, 'Example');

  const editedEntry = { ...entry, text: entry.text.replace('Example', 'Edited') };
  const edited = parseEntryDocumentMeta(editedEntry);
  assert.notEqual(edited, first);
  assert.equal(edited.meta.title, 'Edited');
});

test('document metadata normalizes social image aliases', () => {
  const parseMeta = (frontmatter: string) =>
    parseEntryDocumentMeta({
      path: 'posts/example.md',
      kind: 'text' as const,
      mediaType: 'text/markdown; charset=utf-8',
      text: `---\n${frontmatter}\n---\n\n# Example\n`,
    }).meta;

  assert.equal(
    parseMeta('socialImage: /explicit.png\nimage: /alias.png').socialImage,
    '/explicit.png',
  );
  assert.equal(parseMeta('image: /alias.png').socialImage, '/alias.png');
  assert.equal(parseMeta('cover: /cover.png').socialImage, '/cover.png');
  assert.equal(parseMeta('title: No Image').socialImage, undefined);
});

test('renderMarkdown preserves trusted raw html media tags', async () => {
  const html = await renderMarkdown([
    'Intro paragraph.',
    '',
    '<video controls preload="metadata" src="./clip.mp4"></video>',
    '',
    '<details><summary>More</summary><p>Hidden body</p></details>',
  ].join('\n'));

  assert.ok(html.includes('<video'));
  assert.ok(html.includes('src="./clip.mp4"'));
  assert.ok(html.includes('<details>'));
  assert.ok(html.includes('<summary>More</summary>'));
  assert.ok(html.includes('<p>Hidden body</p>'));
});

test('parseMarkdownDocument preserves raw html and still rewrites markdown links', async () => {
  const parsed = await parseMarkdownDocument(
    'posts/example.md',
    [
      '# Example',
      '',
      '[Guide](./guide.md)',
      '',
      '<video controls src="./clip.mp4"></video>',
    ].join('\n'),
  );

  assert.ok(parsed.html.includes('href="./guide"'));
  assert.ok(parsed.html.includes('<video'));
  assert.ok(parsed.html.includes('src="./clip.mp4"'));
});

test('rewriteMarkdownLinksInHtml does not rewrite raw html media src attributes', () => {
  const rewritten = rewriteMarkdownLinksInHtml(
    '<video controls src="./clip.mp4"></video><a href="./guide.md">Guide</a>',
  );

  assert.ok(rewritten.includes('<video controls src="./clip.mp4"></video>'));
  assert.ok(rewritten.includes('<a href="./guide">Guide</a>'));
});

test('parseMarkdownDocument adds lazy loading attributes to rendered images', async () => {
  const parsed = await parseMarkdownDocument(
    'posts/example.md',
    ['# Example', '', '![Diagram](./diagram.png)'].join('\n'),
  );

  assert.match(
    parsed.html,
    /<img src="\.\/diagram\.png" alt="Diagram" loading="lazy" decoding="async">/,
  );
});

test('parseMarkdownDocument preserves author-specified image loading attribute', async () => {
  const parsed = await parseMarkdownDocument(
    'posts/example.md',
    '<img src="/hero.png" loading="eager" alt="Hero">',
  );

  assert.ok(parsed.html.includes('loading="eager"'));
  assert.ok(!parsed.html.includes('loading="lazy"'));
  assert.ok(parsed.html.includes('decoding="async"'));
});

test('parseMarkdownDocument rewrites known asset sources to the external origin', async () => {
  const resolveAssetUrl = createExternalAssetUrlResolver(
    'https://img.example.com',
    new Set(['mcp-events/cover.webp']),
  );
  const parsed = await parseMarkdownDocument(
    'mcp-events/index.md',
    [
      '# Events',
      '',
      '![Cover](./cover.webp)',
      '',
      '![Missing](./missing.webp)',
      '',
      '<video controls src="./clip.mp4"></video>',
    ].join('\n'),
    {
      requestPath: '/mcp-events/',
      resolveAssetUrl,
    },
  );

  assert.ok(
    parsed.html.includes(
      'src="https://img.example.com/mcp-events/cover.webp"',
    ),
  );
  assert.ok(parsed.html.includes('src="./missing.webp"'));
  assert.ok(parsed.html.includes('src="./clip.mp4"'));
});

test('parseMarkdownDocument leaves media sources alone without an asset resolver', async () => {
  const parsed = await parseMarkdownDocument(
    'mcp-events/index.md',
    '![Cover](./cover.webp)',
    { requestPath: '/mcp-events/' },
  );

  assert.ok(parsed.html.includes('src="./cover.webp"'));
});
