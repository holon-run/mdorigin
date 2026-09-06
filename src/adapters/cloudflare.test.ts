import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createCloudflareWorker,
  withSearchResultCache,
  type CreateCloudflareWorkerOptions,
} from './cloudflare.js';
import { getMediaTypeForPath } from '../core/content-store.js';
import { buildSearchBundle } from '../search.js';
import type { SearchHit } from '../search.js';

test('cloudflare worker serves html and hides drafts', async () => {
  const worker = createCloudflareWorker({
    siteConfig: {
      siteTitle: 'Worker Test',
      siteUrl: undefined,
      favicon: undefined,
      logo: undefined,
      showDate: true,
      showSummary: true,
      topNav: [],
      footerNav: [],
      footerText: undefined,
      socialLinks: [],
      editLink: undefined,
      showHomeIndex: true,
      listingInitialPostCount: 10,
      listingLoadMoreStep: 10,
      stylesheetContent: 'body { font-family: serif; }',
      siteTitleConfigured: true,
      siteDescriptionConfigured: false,
    },
    entries: [
      {
        path: 'index.md',
        kind: 'text',
        mediaType: 'text/markdown; charset=utf-8',
        text: '# Hello',
      },
      {
        path: 'draft.md',
        kind: 'text',
        mediaType: 'text/markdown; charset=utf-8',
        text: ['---', 'draft: true', '---', '', '# Draft'].join('\n'),
      },
      {
        path: 'posts/foo.md',
        kind: 'text',
        mediaType: 'text/markdown; charset=utf-8',
        text: '# Foo',
      },
      {
        path: 'browse/entry.md',
        kind: 'text',
        mediaType: 'text/markdown; charset=utf-8',
        text: '# Entry',
      },
      {
        path: 'browse/nested/note.md',
        kind: 'text',
        mediaType: 'text/markdown; charset=utf-8',
        text: '# Note',
      },
    ],
  });

  const homeResponse = await worker.fetch(new Request('https://example.com/'));
  assert.equal(homeResponse.status, 200);
  const homeHtml = await homeResponse.text();
  assert.match(homeHtml, /<h1>Hello<\/h1>/);
  assert.match(homeHtml, /Worker Test/);
  assert.match(homeHtml, /font-family: serif/);

  const draftResponse = await worker.fetch(
    new Request('https://example.com/draft.html'),
  );
  assert.equal(draftResponse.status, 404);

  const defaultRouteResponse = await worker.fetch(
    new Request('https://example.com/posts/foo'),
  );
  assert.equal(defaultRouteResponse.status, 200);
  assert.match(await defaultRouteResponse.text(), /<h1>Foo<\/h1>/);

  const listingResponse = await worker.fetch(
    new Request('https://example.com/browse/'),
  );
  assert.equal(listingResponse.status, 200);
  assert.match(await listingResponse.text(), /href="\/browse\/entry"/);
});

function createCacheTestWorker(
  overrides: {
    deployVersion?: string;
    workerOptions?: CreateCloudflareWorkerOptions;
  } = {},
) {
  const { workerOptions, ...manifestOverrides } = overrides;
  return createCloudflareWorker({
    ...manifestOverrides,
    siteConfig: {
      siteTitle: 'Worker Cache Test',
      siteUrl: 'https://example.com',
      favicon: undefined,
      logo: undefined,
      showDate: true,
      showSummary: true,
      topNav: [],
      footerNav: [],
      footerText: undefined,
      socialLinks: [],
      editLink: undefined,
      showHomeIndex: true,
      listingInitialPostCount: 10,
      listingLoadMoreStep: 10,
      siteTitleConfigured: true,
      siteDescriptionConfigured: false,
    },
    entries: [
      {
        path: 'index.md',
        kind: 'text',
        mediaType: 'text/markdown; charset=utf-8',
        text: '# Hello',
      },
    ],
  }, workerOptions);
}

test('cloudflare worker adds cache headers and serves 304 for deploy-versioned bundles', async () => {
  const worker = createCacheTestWorker({ deployVersion: '0123456789abcdef' });
  const etag = '"0123456789abcdef"';

  const htmlResponse = await worker.fetch(new Request('https://example.com/'));
  assert.equal(htmlResponse.status, 200);
  assert.equal(htmlResponse.headers.get('etag'), etag);
  assert.equal(
    htmlResponse.headers.get('cache-control'),
    'public, max-age=120, stale-while-revalidate=604800',
  );
  assert.match(htmlResponse.headers.get('vary') ?? '', /^Accept$/);
  // Extensionless routes vary on Accept and stay out of the CDN cache.
  assert.equal(htmlResponse.headers.get('cdn-cache-control'), null);

  const notModifiedResponse = await worker.fetch(
    new Request('https://example.com/', {
      headers: { 'if-none-match': etag },
    }),
  );
  assert.equal(notModifiedResponse.status, 304);
  assert.equal(notModifiedResponse.headers.get('etag'), etag);
  assert.equal(await notModifiedResponse.text(), '');

  const weakTagResponse = await worker.fetch(
    new Request('https://example.com/', {
      headers: { 'if-none-match': `W/${etag}` },
    }),
  );
  assert.equal(weakTagResponse.status, 304);

  const staleResponse = await worker.fetch(
    new Request('https://example.com/', {
      headers: { 'if-none-match': '"stale-version"' },
    }),
  );
  assert.equal(staleResponse.status, 200);
  assert.match(await staleResponse.text(), /<h1>Hello<\/h1>/);

  // Explicit .md paths have one deterministic variant and may enter the CDN cache.
  const markdownResponse = await worker.fetch(
    new Request('https://example.com/index.md'),
  );
  assert.equal(markdownResponse.status, 200);
  assert.equal(markdownResponse.headers.get('cdn-cache-control'), 'max-age=86400');
  assert.equal(markdownResponse.headers.get('vary'), null);

  // Query-dependent responses stay uncached.
  const queryResponse = await worker.fetch(new Request('https://example.com/?q=x'));
  assert.equal(queryResponse.headers.get('etag'), null);
  assert.equal(queryResponse.headers.get('cdn-cache-control'), null);

  // API routes stay uncached.
  const apiResponse = await worker.fetch(
    new Request('https://example.com/api/openapi.json'),
  );
  assert.equal(apiResponse.status, 200);
  assert.equal(apiResponse.headers.get('etag'), null);
  assert.equal(apiResponse.headers.get('cdn-cache-control'), null);

  const sitemapResponse = await worker.fetch(
    new Request('https://example.com/sitemap.xml'),
  );
  assert.equal(sitemapResponse.status, 200);
  assert.equal(sitemapResponse.headers.get('cdn-cache-control'), 'max-age=86400');
});

test('cloudflare worker omits cache headers when the bundle has no deploy version', async () => {
  const worker = createCacheTestWorker();
  const response = await worker.fetch(new Request('https://example.com/'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('cache-control'), null);
  assert.equal(response.headers.get('cdn-cache-control'), null);
});

test('cloudflare worker supports page render plugins', async () => {
  const worker = createCloudflareWorker(
    {
      siteConfig: {
        siteTitle: 'Worker Test',
        siteUrl: undefined,
        favicon: undefined,
        logo: undefined,
        showDate: true,
        showSummary: true,
        topNav: [],
        footerNav: [],
        footerText: undefined,
        socialLinks: [],
        editLink: undefined,
        showHomeIndex: true,
        listingInitialPostCount: 10,
        listingLoadMoreStep: 10,
        siteTitleConfigured: true,
        siteDescriptionConfigured: false,
      },
      entries: [
        {
          path: 'README.md',
          kind: 'text',
          mediaType: 'text/markdown; charset=utf-8',
          text: '# Hello',
        },
      ],
    },
    {
      plugins: [
        {
          renderPage(page) {
            return `<html><body><main class="worker-plugin">${page.title}</main></body></html>`;
          },
        },
      ],
    },
  );

  const response = await worker.fetch(new Request('https://example.com/'));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /class="worker-plugin"/);
});

test('cloudflare worker serves assets-backed binaries through ASSETS binding', async () => {
  const worker = createCloudflareWorker({
    siteConfig: {
      siteTitle: 'Worker Test',
      siteUrl: undefined,
      favicon: undefined,
      logo: undefined,
      showDate: true,
      showSummary: true,
      topNav: [],
      footerNav: [],
      footerText: undefined,
      socialLinks: [],
      editLink: undefined,
      showHomeIndex: true,
      listingInitialPostCount: 10,
      listingLoadMoreStep: 10,
      siteTitleConfigured: true,
      siteDescriptionConfigured: false,
    },
    runtime: {
      binaryMode: 'external',
    },
    entries: [
      {
        path: 'images/cat.png',
        kind: 'binary',
        mediaType: 'image/png',
        storageKind: 'assets',
        storageKey: 'images/cat.png',
        byteSize: 3,
      },
    ],
  });

  let fetchedRequest: Request | undefined;
  const response = await worker.fetch(
    new Request('https://example.com/images/cat.png'),
    {
      ASSETS: {
        fetch: async (request) => {
          fetchedRequest = request;
          return new Response(Uint8Array.from([1, 2, 3]), {
            headers: { 'content-type': 'image/png' },
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(fetchedRequest?.url, 'https://example.com/images/cat.png');
  assert.deepEqual(
    Array.from(new Uint8Array(await response.arrayBuffer())),
    [1, 2, 3],
  );
});

test('cloudflare worker serves r2-backed binaries through configured bucket binding', async () => {
  const worker = createCloudflareWorker({
    siteConfig: {
      siteTitle: 'Worker Test',
      siteUrl: undefined,
      favicon: undefined,
      logo: undefined,
      showDate: true,
      showSummary: true,
      topNav: [],
      footerNav: [],
      footerText: undefined,
      socialLinks: [],
      editLink: undefined,
      showHomeIndex: true,
      listingInitialPostCount: 10,
      listingLoadMoreStep: 10,
      siteTitleConfigured: true,
      siteDescriptionConfigured: false,
    },
    runtime: {
      binaryMode: 'external',
      r2Binding: 'MDORIGIN_R2',
    },
    entries: [
      {
        path: 'videos/demo.mp4',
        kind: 'binary',
        mediaType: 'video/mp4',
        storageKind: 'r2',
        storageKey: 'binary/abcd.mp4',
        byteSize: 4,
      },
    ],
  });

  const response = await worker.fetch(
    new Request('https://example.com/videos/demo.mp4'),
    {
      MDORIGIN_R2: {
        get: async () => ({
          body: null,
          arrayBuffer: async () => Uint8Array.from([4, 5, 6, 7]).buffer,
        }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    Array.from(new Uint8Array(await response.arrayBuffer())),
    [4, 5, 6, 7],
  );
});

test('cloudflare worker streams r2-backed binaries without buffering into content store', async () => {
  const worker = createCloudflareWorker({
    siteConfig: {
      siteTitle: 'Worker Test',
      siteUrl: undefined,
      favicon: undefined,
      logo: undefined,
      showDate: true,
      showSummary: true,
      topNav: [],
      footerNav: [],
      footerText: undefined,
      socialLinks: [],
      editLink: undefined,
      showHomeIndex: true,
      listingInitialPostCount: 10,
      listingLoadMoreStep: 10,
      siteTitleConfigured: true,
      siteDescriptionConfigured: false,
    },
    runtime: {
      binaryMode: 'external',
      r2Binding: 'MDORIGIN_R2',
    },
    entries: [
      {
        path: 'videos/stream.mp4',
        kind: 'binary',
        mediaType: 'video/mp4',
        storageKind: 'r2',
        storageKey: 'binary/stream.mp4',
        byteSize: 4,
      },
    ],
  });

  let arrayBufferCalled = false;
  const response = await worker.fetch(
    new Request('https://example.com/videos/stream.mp4'),
    {
      MDORIGIN_R2: {
        get: async () => ({
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Uint8Array.from([9, 8, 7, 6]));
              controller.close();
            },
          }),
          arrayBuffer: async () => {
            arrayBufferCalled = true;
            return Uint8Array.from([9, 8, 7, 6]).buffer;
          },
        }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(arrayBufferCalled, false);
  assert.deepEqual(
    Array.from(new Uint8Array(await response.arrayBuffer())),
    [9, 8, 7, 6],
  );
});

test('cloudflare worker serves /api/search from assets-backed external search bundle', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-cf-search-runtime-root-'));
  const searchDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-cf-search-runtime-dir-'));
  await mkdir(path.join(rootDir, 'guides'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'index.md'),
    '# Home\n\nSee [Cloudflare](./guides/cloudflare.md).\n',
    'utf8',
  );
  await writeFile(
    path.join(rootDir, 'guides', 'cloudflare.md'),
    '# Cloudflare Deployment\n\nUse mdorigin build cloudflare and wrangler deploy.\n',
    'utf8',
  );
  await buildSearchBundle({
    rootDir,
    outDir: searchDir,
    siteConfig: {
      siteTitle: 'Worker Test',
      siteUrl: undefined,
      favicon: undefined,
      logo: undefined,
      showDate: true,
      showSummary: true,
      topNav: [],
      footerNav: [],
      footerText: undefined,
      socialLinks: [],
      editLink: undefined,
      showHomeIndex: true,
      listingInitialPostCount: 10,
      listingLoadMoreStep: 10,
      siteTitleConfigured: true,
      siteDescriptionConfigured: false,
    },
    embeddingBackend: 'hashing',
  });
  const searchFiles = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const externalSearchEntries: Array<{
    path: string;
    mediaType: string;
    storageKind: 'assets';
    storageKey: string;
    byteSize: number;
  }> = [];
  for (const fileName of await readdir(searchDir)) {
    const filePath = path.join(searchDir, fileName);
    const fileStats = await stat(filePath);
    const mediaType = getMediaTypeForPath(fileName);
    const bytes = await readFile(filePath);
    searchFiles.set(`/__mdorigin/search/${fileName}`, { bytes, mediaType });
    externalSearchEntries.push({
      path: fileName,
      mediaType,
      storageKind: 'assets',
      storageKey: `__mdorigin/search/${fileName}`,
      byteSize: fileStats.size,
    });
  }

  const worker = createCloudflareWorker({
    siteConfig: {
      siteTitle: 'Worker Test',
      siteUrl: undefined,
      favicon: undefined,
      logo: undefined,
      showDate: true,
      showSummary: true,
      topNav: [],
      footerNav: [],
      footerText: undefined,
      socialLinks: [],
      editLink: undefined,
      showHomeIndex: true,
      listingInitialPostCount: 10,
      listingLoadMoreStep: 10,
      siteTitleConfigured: true,
      siteDescriptionConfigured: false,
    },
    runtime: {
      binaryMode: 'inline',
    },
    entries: [
      {
        path: 'index.md',
        kind: 'text',
        mediaType: 'text/markdown; charset=utf-8',
        text: '# Hello',
      },
    ],
    externalSearchEntries,
  });

  const response = await worker.fetch(
    new Request('https://example.com/api/search?q=cloudflare'),
    {
      ASSETS: {
        fetch: async (request) => {
          const file = searchFiles.get(new URL(request.url).pathname);
          if (!file) {
            return new Response('Not Found', { status: 404 });
          }

          return new Response(file.bytes, {
            headers: { 'content-type': file.mediaType },
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  const json = (await response.json()) as { hits: Array<{ title?: string }> };
  assert.equal(json.hits[0]?.title, 'Cloudflare Deployment');
});

test('cloudflare worker memoizes rendered responses per isolate variant', async () => {
  let htmlRenders = 0;
  const worker = createCacheTestWorker({
    deployVersion: 'memo000000000001',
    workerOptions: {
      plugins: [
        {
          transformHtml(html) {
            htmlRenders += 1;
            return html;
          },
        },
      ],
    },
  });

  const first = await worker.fetch(new Request('https://example.com/'));
  assert.equal(first.status, 200);
  assert.equal(htmlRenders, 1);
  const firstHtml = await first.text();

  const second = await worker.fetch(new Request('https://example.com/'));
  assert.equal(htmlRenders, 1);
  assert.equal(await second.text(), firstHtml);
  assert.equal(second.headers.get('etag'), '"memo000000000001"');
  assert.equal(
    second.headers.get('cache-control'),
    'public, max-age=120, stale-while-revalidate=604800',
  );

  // The Accept-negotiated markdown variant is a separate cache entry.
  const markdownFirst = await worker.fetch(
    new Request('https://example.com/', {
      headers: { accept: 'text/markdown' },
    }),
  );
  assert.equal(markdownFirst.status, 200);
  assert.match(
    markdownFirst.headers.get('content-type') ?? '',
    /^text\/markdown/,
  );
  const markdownBody = await markdownFirst.text();
  assert.match(markdownBody, /# Hello/);

  const markdownAgain = await worker.fetch(
    new Request('https://example.com/', {
      headers: { accept: 'text/html;q=0.5, text/markdown' },
    }),
  );
  assert.equal(await markdownAgain.text(), markdownBody);

  // Explicit .md paths use their own deterministic variant key.
  const explicitMd = await worker.fetch(
    new Request('https://example.com/index.md'),
  );
  assert.equal(explicitMd.status, 200);
  const explicitMdAgain = await worker.fetch(
    new Request('https://example.com/index.md'),
  );
  assert.equal(await explicitMdAgain.text(), await explicitMd.text());
});

test('cloudflare worker reports cache status and evicts isolate entries', async () => {
  let htmlRenders = 0;
  const worker = createCacheTestWorker({
    deployVersion: 'lru00000000000001',
    workerOptions: {
      responseCacheLimit: 1,
      plugins: [
        {
          transformHtml(html) {
            htmlRenders += 1;
            return html;
          },
        },
      ],
    },
  });

  const missResponse = await worker.fetch(new Request('https://example.com/'), {
    MDORIGIN_CACHE_DEBUG: '1',
  });
  assert.equal(missResponse.headers.get('x-mdorigin-cache'), 'miss');
  assert.equal(htmlRenders, 1);

  const hitResponse = await worker.fetch(new Request('https://example.com/'), {
    MDORIGIN_CACHE_DEBUG: '1',
  });
  assert.equal(hitResponse.headers.get('x-mdorigin-cache'), 'l1');
  assert.equal(htmlRenders, 1);

  // A distinct entry evicts the memoized home response (limit 1) and the
  // next home request has to render again. Without the debug var the
  // debug header stays absent.
  await worker.fetch(new Request('https://example.com/index.md'));
  const evictedResponse = await worker.fetch(new Request('https://example.com/'));
  assert.equal(evictedResponse.headers.get('x-mdorigin-cache'), null);
  assert.equal(htmlRenders, 2);
});

class MemoryCacheStub {
  readonly entries = new Map<string, Response>();
  readonly putKeys: string[] = [];

  async match(request: Request): Promise<Response | undefined> {
    const stored = this.entries.get(new URL(request.url).pathname);
    return stored === undefined ? undefined : stored.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    const key = new URL(request.url).pathname;
    this.putKeys.push(key);
    this.entries.set(key, response.clone());
  }
}

test('cloudflare worker uses the injected cache as per-colo L2 storage', async () => {
  const cacheStub = new MemoryCacheStub();
  const worker = createCacheTestWorker({
    deployVersion: 'l2test00000000001',
    workerOptions: {
      cache: cacheStub,
      responseCacheLimit: 0,
    },
  });

  const first = await worker.fetch(new Request('https://example.com/'));
  assert.equal(first.status, 200);
  await first.text();
  assert.deepEqual(cacheStub.putKeys, ['/l2test00000000001/html/']);

  const markdown = await worker.fetch(
    new Request('https://example.com/', {
      headers: { accept: 'text/markdown' },
    }),
  );
  await markdown.text();
  assert.deepEqual(cacheStub.putKeys, [
    '/l2test00000000001/html/',
    '/l2test00000000001/md/',
  ]);

  // Stored entries carry the L2 TTL while client responses keep browser TTL.
  const stored = await cacheStub.match(
    new Request('https://cache.mdorigin.internal/l2test00000000001/html/'),
  );
  assert.equal(
    stored?.headers.get('cache-control'),
    'public, max-age=86400',
  );

  // With the isolate cache disabled, the repeat request is served from L2.
  const second = await worker.fetch(new Request('https://example.com/'));
  assert.equal(second.status, 200);
  assert.match(await second.text(), /<h1>Hello<\/h1>/);
  assert.equal(
    second.headers.get('cache-control'),
    'public, max-age=120, stale-while-revalidate=604800',
  );
  assert.equal(second.headers.get('etag'), '"l2test00000000001"');
});

test('withSearchResultCache memoizes deterministic search results', async () => {
  let calls = 0;
  const hit: SearchHit = {
    docId: 'index',
    relativePath: 'index.md',
    metadata: {},
    score: 1,
    bestMatch: {
      chunkId: 0,
      excerpt: 'Hello',
      headingPath: [],
      charStart: 0,
      charEnd: 5,
      score: 1,
    },
  };
  const api = withSearchResultCache(
    {
      search: async (query, options) => {
        calls += 1;
        return [{ ...hit, docId: `${query}:${options?.topK ?? 0}` }];
      },
    },
    2,
  );

  const first = await api.search('cloudflare', { topK: 5 });
  const memoized = await api.search('cloudflare', { topK: 5 });
  assert.equal(calls, 1);
  assert.deepEqual(memoized, first);

  await api.search('cloudflare', { topK: 10 });
  assert.equal(calls, 2);

  // LRU limit 2: the oldest key was evicted by the later entries.
  await api.search('deploy', { topK: 5 });
  await api.search('cloudflare', { topK: 5 });
  assert.equal(calls, 4);
});
