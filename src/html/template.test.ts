import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDocument } from './template.js';

test('renderDocument emits default Open Graph and Twitter metadata', () => {
  const html = renderDocument({
    siteTitle: 'Example Site',
    siteDescription: 'Site description',
    siteUrl: 'https://example.com',
    socialImage: '/social.png',
    title: 'Frontmatter title',
    summary: 'Frontmatter summary',
    body: '<p>Content</p>',
    canonicalPath: '/guides/example',
  });

  assert.match(html, /<title>Frontmatter title \| Example Site<\/title>/);
  assert.match(html, /<meta property="og:title" content="Frontmatter title">/);
  assert.match(html, /<meta property="og:description" content="Frontmatter summary">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/example\.com\/guides\/example">/);
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.match(html, /<meta name="twitter:title" content="Frontmatter title">/);
  assert.match(html, /<meta name="twitter:description" content="Frontmatter summary">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
});

test('renderDocument keeps absolute social image URLs untouched', () => {
  const html = renderDocument({
    siteTitle: 'Example Site',
    siteUrl: 'https://example.com',
    socialImage: 'https://cdn.example.com/card.png',
    title: 'Example page',
    body: '<p>Content</p>',
  });

  assert.match(
    html,
    /property="og:image" content="https:\/\/cdn\.example\.com\/card\.png"/,
  );
  assert.match(
    html,
    /name="twitter:image" content="https:\/\/cdn\.example\.com\/card\.png"/,
  );
});

test('renderDocument omits optional social values without a site URL or summary', () => {
  const html = renderDocument({
    siteTitle: 'Example Site',
    title: 'Example page',
    body: '<p>Content</p>',
  });

  assert.match(html, /<meta property="og:title" content="Example page">/);
  assert.doesNotMatch(html, /property="og:description"/);
  assert.doesNotMatch(html, /property="og:url"/);
  assert.doesNotMatch(html, /property="og:image"/);
  assert.doesNotMatch(html, /name="twitter:description"/);
});
