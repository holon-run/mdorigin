import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAssetUrlResolver,
  createExternalAssetUrlResolver,
  createStorageKeyAssetUrlResolver,
  normalizeAssetBaseUrl,
} from './asset-urls.js';

const ASSETS = new Set(['mcp-events/cover.webp', 'my image.png', 'shared/a.png']);

function createResolver(baseUrl = 'https://img.example.com'): ReturnType<
  typeof createExternalAssetUrlResolver
> {
  return createExternalAssetUrlResolver(baseUrl, ASSETS);
}

test('createExternalAssetUrlResolver rewrites page-relative asset hrefs', () => {
  const resolve = createResolver();

  assert.equal(
    resolve('./cover.webp', '/mcp-events/post'),
    'https://img.example.com/mcp-events/cover.webp',
  );
  assert.equal(resolve('cover.webp', '/mcp-events/'), 'https://img.example.com/mcp-events/cover.webp');
});

test('createExternalAssetUrlResolver rewrites root-relative asset hrefs', () => {
  const resolve = createResolver();

  assert.equal(
    resolve('/mcp-events/cover.webp', '/other/page'),
    'https://img.example.com/mcp-events/cover.webp',
  );
});

test('createExternalAssetUrlResolver leaves absolute references untouched', () => {
  const resolve = createResolver();

  assert.equal(resolve('https://cdn.example.com/x.webp', '/mcp-events/'), undefined);
  assert.equal(resolve('//cdn.example.com/x.webp', '/mcp-events/'), undefined);
  assert.equal(resolve('data:image/png;base64,AAAA', '/mcp-events/'), undefined);
});

test('createExternalAssetUrlResolver leaves unknown asset paths untouched', () => {
  const resolve = createResolver();

  assert.equal(resolve('./missing.webp', '/mcp-events/'), undefined);
  assert.equal(resolve('/mcp-events/missing.webp', '/'), undefined);
});

test('createExternalAssetUrlResolver matches percent-encoded hrefs against decoded paths', () => {
  const resolve = createResolver();

  assert.equal(
    resolve('./my%20image.png', '/'),
    'https://img.example.com/my%20image.png',
  );
  assert.equal(resolve('./my image.png', '/'), 'https://img.example.com/my%20image.png');
});

test('createExternalAssetUrlResolver collapses parent segments like a browser', () => {
  const resolve = createResolver();

  assert.equal(
    resolve('../../shared/a.png', '/x/y/page'),
    'https://img.example.com/shared/a.png',
  );
});

test('createExternalAssetUrlResolver preserves query and hash', () => {
  const resolve = createResolver();

  assert.equal(
    resolve('./cover.webp?v=2#fragment', '/mcp-events/'),
    'https://img.example.com/mcp-events/cover.webp?v=2#fragment',
  );
});

const ASSET_STORAGE_KEYS = new Map([
  ['mcp-events/cover.webp', 'binary/5d41402abc4b2a76b9719d911017c592.webp'],
]);

test('createStorageKeyAssetUrlResolver rewrites known asset paths to storage keys', () => {
  const resolve = createStorageKeyAssetUrlResolver(
    'https://assets.example.com',
    ASSET_STORAGE_KEYS,
  );

  assert.equal(
    resolve('./cover.webp', '/mcp-events/post'),
    'https://assets.example.com/binary/5d41402abc4b2a76b9719d911017c592.webp',
  );
  assert.equal(
    resolve('/mcp-events/cover.webp', '/other/page'),
    'https://assets.example.com/binary/5d41402abc4b2a76b9719d911017c592.webp',
  );
});

test('createStorageKeyAssetUrlResolver leaves unknown and absolute references untouched', () => {
  const resolve = createStorageKeyAssetUrlResolver(
    'https://assets.example.com',
    ASSET_STORAGE_KEYS,
  );

  assert.equal(resolve('./inline.webp', '/mcp-events/'), undefined);
  assert.equal(resolve('https://cdn.example.com/x.webp', '/mcp-events/'), undefined);
});

test('createStorageKeyAssetUrlResolver preserves query and hash', () => {
  const resolve = createStorageKeyAssetUrlResolver(
    'https://assets.example.com',
    ASSET_STORAGE_KEYS,
  );

  assert.equal(
    resolve('./cover.webp?v=2#fragment', '/mcp-events/'),
    'https://assets.example.com/binary/5d41402abc4b2a76b9719d911017c592.webp?v=2#fragment',
  );
});

test('applyAssetUrlResolver passes values through without a resolver or match', () => {
  const resolve = createResolver();

  assert.equal(applyAssetUrlResolver(undefined, '/x/', resolve), undefined);
  assert.equal(applyAssetUrlResolver('./cover.webp', '/x/', undefined), './cover.webp');
  assert.equal(applyAssetUrlResolver('./missing.webp', '/x/', resolve), './missing.webp');
});

test('normalizeAssetBaseUrl strips trailing slashes and rejects invalid origins', () => {
  assert.equal(normalizeAssetBaseUrl('https://img.example.com/'), 'https://img.example.com');
  assert.equal(normalizeAssetBaseUrl('https://img.example.com///'), 'https://img.example.com');
  assert.throws(() => normalizeAssetBaseUrl('img.example.com'), /not an absolute URL/);
  assert.throws(() => normalizeAssetBaseUrl('ftp://img.example.com'), /http or https/);
});
