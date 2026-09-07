import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEntryDocumentMeta,
  parseMarkdownDocument,
  renderMarkdown,
  rewriteMarkdownLinksInHtml,
} from './markdown.js';

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
