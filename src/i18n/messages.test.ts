import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSiteMessage,
  resolveSiteMessages,
  validateSiteMessages,
} from './messages.js';

test('resolveSiteMessages returns the english catalog by default', () => {
  const messages = resolveSiteMessages(undefined);
  assert.equal(messages['search.toggle'], 'Search');
  assert.equal(messages['error.notFoundTitle'], 'Not Found');
});

test('resolveSiteMessages applies the built-in catalog for a known locale', () => {
  const messages = resolveSiteMessages('zh-CN');
  assert.equal(messages['search.toggle'], '搜索');
  assert.equal(messages['listing.loadMore'], '加载更多');
});

test('resolveSiteMessages falls back to english for unknown locales', () => {
  const messages = resolveSiteMessages('xx-YY');
  assert.equal(messages['search.toggle'], 'Search');
});

test('resolveSiteMessages resolves locales case-insensitively', () => {
  const messages = resolveSiteMessages('zh-cn');
  assert.equal(messages['search.toggle'], '搜索');
});

test('resolveSiteMessages applies user overrides last', () => {
  const messages = resolveSiteMessages('zh-CN', {
    'search.toggle': '找一找',
    'listing.emptyDirectory': '空目录',
  });
  assert.equal(messages['search.toggle'], '找一找');
  assert.equal(messages['listing.emptyDirectory'], '空目录');
  assert.equal(messages['search.go'], '搜索');
});

test('formatSiteMessage interpolates placeholders', () => {
  assert.equal(
    formatSiteMessage('Search failed ({status}).', { status: '500' }),
    'Search failed (500).',
  );
  assert.equal(
    formatSiteMessage('No page at <code>{path}</code>.', { path: '/x' }),
    'No page at <code>/x</code>.',
  );
});

test('validateSiteMessages keeps known string keys and reports unknown keys', () => {
  const { messages, unknownKeys } = validateSiteMessages({
    'search.go': 'Los',
    'search.toggle': '',
    'search.togle': 'typo',
    other: 42,
  });

  assert.deepEqual(messages, { 'search.go': 'Los' });
  assert.deepEqual(unknownKeys, ['search.togle', 'other']);
});
