import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryContentStore } from './content-store.js';
import { handleSiteRequest } from './request-handler.js';
import { resolveRequest } from './router.js';

const TEST_SITE_CONFIG = {
  siteTitle: 'Test Site',
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
};

test('resolveRequest maps html, markdown, default html, index, and assets', () => {
  assert.deepEqual(resolveRequest('/'), {
    kind: 'html',
    requestPath: '/',
    sourcePath: 'index.md',
  });
  assert.deepEqual(resolveRequest('/topic/post'), {
    kind: 'html',
    requestPath: '/topic/post',
    sourcePath: 'topic/post.md',
  });
  assert.deepEqual(resolveRequest('/topic/'), {
    kind: 'html',
    requestPath: '/topic/',
    sourcePath: 'topic/index.md',
  });
  assert.deepEqual(resolveRequest('/topic/index.html'), {
    kind: 'html',
    requestPath: '/topic/index.html',
    sourcePath: 'topic/index.md',
  });
  assert.deepEqual(resolveRequest('/note.md'), {
    kind: 'markdown',
    requestPath: '/note.md',
    sourcePath: 'note.md',
  });
  assert.deepEqual(resolveRequest('/topic/diagram.png'), {
    kind: 'asset',
    requestPath: '/topic/diagram.png',
    sourcePath: 'topic/diagram.png',
  });
});

test('resolveRequest rejects traversal paths', () => {
  assert.equal(resolveRequest('/../secret').kind, 'not-found');
  assert.equal(resolveRequest('/%2E%2E/secret').kind, 'not-found');
  assert.equal(resolveRequest('/.DS_Store').kind, 'not-found');
  assert.equal(resolveRequest('/.hidden/note.md').kind, 'not-found');
});

test('handleSiteRequest renders html and preserves markdown', async () => {
  const store = new MemoryContentStore([
    {
      path: 'topic/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Topic Home',
        'summary: Topic summary',
        '---',
        '',
        '# Topic',
        '',
        '![](./diagram.png)',
      ].join('\n'),
    },
    {
      path: 'topic/diagram.png',
      kind: 'binary',
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    },
    {
      path: 'topic/post.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['# Post', '', '[Nested](./guide.md)', '', '[Topic Home](./index.md)', '', '[Root Home](../README.md)'].join('\n'),
    },
    {
      path: 'topic/guide.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Guide',
    },
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Home',
    },
  ]);

  const htmlResponse = await handleSiteRequest(store, '/topic/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(htmlResponse.status, 200);
  assert.match(String(htmlResponse.body), /Topic Home/);
  assert.match(String(htmlResponse.body), /<img src="\.\.\/?diagram\.png"|<img src="\.\/diagram\.png"/);

  const markdownResponse = await handleSiteRequest(store, '/topic/index.md', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(markdownResponse.status, 200);
  assert.match(String(markdownResponse.body), /^---/m);

  const defaultHtmlResponse = await handleSiteRequest(store, '/topic/post', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(defaultHtmlResponse.status, 200);
  assert.match(String(defaultHtmlResponse.body), /<h1>Post<\/h1>/);
  assert.match(String(defaultHtmlResponse.body), /Test Site/);
  assert.match(String(defaultHtmlResponse.body), /href="\.\/guide"/);
  assert.match(String(defaultHtmlResponse.body), /href="\.\/"/);
  assert.match(String(defaultHtmlResponse.body), /href="\.\.\/"/);
});

test('handleSiteRequest varies directory index html on Accept', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Home',
    },
    {
      path: 'guides/README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Guides',
    },
  ]);

  const htmlResponse = await handleSiteRequest(store, '/', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(htmlResponse.status, 200);
  assert.equal(htmlResponse.headers['vary'], 'Accept');

  const sectionHtmlResponse = await handleSiteRequest(store, '/guides/', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(sectionHtmlResponse.status, 200);
  assert.equal(sectionHtmlResponse.headers['vary'], 'Accept');

  const markdownResponse = await handleSiteRequest(store, '/', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
    acceptHeader: 'text/markdown',
  });
  assert.equal(markdownResponse.status, 200);
  assert.match(
    String(markdownResponse.headers['content-type'] ?? ''),
    /text\/markdown/,
  );
});

test('handleSiteRequest preserves trusted inline html media tags in rendered pages', async () => {
  const store = new MemoryContentStore([
    {
      path: 'posts/video.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '# Video Post',
        '',
        '<video controls preload="metadata" src="./clip.mp4"></video>',
      ].join('\n'),
    },
    {
      path: 'posts/clip.mp4',
      kind: 'binary',
      mediaType: 'video/mp4',
      bytes: new Uint8Array([1, 2, 3, 4]),
    },
  ]);

  const response = await handleSiteRequest(store, '/posts/video', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 200);
  const body = String(response.body);
  assert.ok(body.includes('<video'));
  assert.ok(body.includes('src="./clip.mp4"'));
  assert.ok(body.includes('preload="metadata"'));
});

test('handleSiteRequest supports page render plugins', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Home', '---', '', '# Home', '', 'Welcome.'].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
    plugins: [
      {
        name: 'custom-page',
        renderPage(page) {
          return `<html><body><main class="custom-page"><h1>${page.title}</h1><div>${page.bodyHtml}</div></main></body></html>`;
        },
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /class="custom-page"/);
  assert.doesNotMatch(String(response.body), /class="site-header"/);
});

test('handleSiteRequest uses the final page model for downstream plugin hooks', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Home', '---', '', '# Home', '', 'Welcome.'].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
    plugins: [
      {
        name: 'rename-page',
        renderPage(page, _context, next) {
          return next({
            ...page,
            title: 'Renamed Home',
          });
        },
        transformHtml(html, context) {
          return html.replace('</body>', `<meta data-title="${context.page.title}"></body>`);
        },
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /<title>Renamed Home \| Test Site<\/title>/);
  assert.match(String(response.body), /data-title="Renamed Home"/);
});

test('handleSiteRequest exposes normalized frontmatter meta to page plugins', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Home',
        'summary: Home summary',
        'date: 2026-03-28',
        'syndication:',
        '  - platform: X / Twitter',
        '    url: https://x.com/jolestar/status/123',
        'customMeta: custom-value',
        '---',
        '',
        '# Home',
      ].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
    plugins: [
      {
        name: 'inspect-meta',
        renderPage(page, _context, next) {
          assert.equal(page.meta.title, 'Home');
          assert.equal(page.meta.summary, 'Home summary');
          assert.equal(page.meta.date, '2026-03-28');
          assert.equal(page.meta.customMeta, 'custom-value');
          assert.deepEqual(page.meta.syndication, [
            {
              platform: 'X / Twitter',
              url: 'https://x.com/jolestar/status/123',
            },
          ]);
          return next(page);
        },
        transformHtml(html, context) {
          const items = Array.isArray(context.page.meta.syndication)
            ? context.page.meta.syndication
            : [];
          return html.replace(
            '</body>',
            `<meta data-syndication-count="${items.length}" data-custom-meta="${context.page.meta.customMeta}"></body>`,
          );
        },
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /data-syndication-count="1"/);
  assert.match(String(response.body), /data-custom-meta="custom-value"/);
});

test('handleSiteRequest serves markdown on extensionless routes when accept asks for markdown', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Home', '---', '', '# Home'].join('\n'),
    },
    {
      path: 'topic/README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Topic Home', '---', '', '# Topic Home'].join('\n'),
    },
    {
      path: 'topic/post.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Post', '---', '', '# Post'].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/topic/post', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
    acceptHeader: 'text/markdown, text/html;q=0.9',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.equal(response.headers.vary, 'Accept');
  assert.match(String(response.body), /^---/m);

  const homeResponse = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
    acceptHeader: 'text/markdown',
  });
  assert.equal(homeResponse.status, 200);
  assert.equal(homeResponse.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.equal(homeResponse.headers.vary, 'Accept');
  assert.match(String(homeResponse.body), /^---/m);

  const directoryResponse = await handleSiteRequest(store, '/topic/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
    acceptHeader: 'text/markdown',
  });
  assert.equal(directoryResponse.status, 200);
  assert.equal(
    directoryResponse.headers['content-type'],
    'text/markdown; charset=utf-8',
  );
  assert.equal(directoryResponse.headers.vary, 'Accept');
  assert.match(String(directoryResponse.body), /^---/m);
});

test('handleSiteRequest keeps explicit html routes as html even when markdown is accepted', async () => {
  const store = new MemoryContentStore([
    {
      path: 'topic/post.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Post',
    },
  ]);

  const response = await handleSiteRequest(store, '/topic/post.html', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
    acceptHeader: 'text/markdown, text/html;q=0.9',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.headers.vary, undefined);
  assert.match(String(response.body), /<h1>Post<\/h1>/);
});

test('handleSiteRequest filters drafts in exclude mode', async () => {
  const store = new MemoryContentStore([
    {
      path: 'draft.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'draft: true', '---', '', '# Draft'].join('\n'),
    },
  ]);

  const included = await handleSiteRequest(store, '/draft.html', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(included.status, 200);

  const excluded = await handleSiteRequest(store, '/draft.md', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(excluded.status, 404);
});

test('handleSiteRequest renders html 404 pages but keeps markdown 404 plain text', async () => {
  const store = new MemoryContentStore([]);

  const htmlResponse = await handleSiteRequest(store, '/missing', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(htmlResponse.status, 404);
  assert.equal(htmlResponse.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(htmlResponse.headers.vary, 'Accept');
  assert.match(String(htmlResponse.body), /<h1>Not Found<\/h1>/);
  assert.match(String(htmlResponse.body), /No page was published at <code>\/missing<\/code>/);
  assert.match(String(htmlResponse.body), /<title>Not Found \| Test Site<\/title>/);

  const negotiatedMarkdownResponse = await handleSiteRequest(store, '/missing', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
    acceptHeader: 'text/markdown',
  });

  assert.equal(negotiatedMarkdownResponse.status, 404);
  assert.equal(negotiatedMarkdownResponse.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(negotiatedMarkdownResponse.headers.vary, 'Accept');
  assert.equal(String(negotiatedMarkdownResponse.body), 'Not Found');

  const markdownResponse = await handleSiteRequest(store, '/missing.md', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(markdownResponse.status, 404);
  assert.equal(markdownResponse.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(markdownResponse.headers.vary, undefined);
  assert.equal(String(markdownResponse.body), 'Not Found');
});

test('handleSiteRequest renders sitemap.xml with canonical html urls', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Home', 'date: 2026-03-20', '---', '', '# Home'].join('\n'),
    },
    {
      path: 'guides/README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Guides', 'date: 2026-03-21', '---', '', '# Guides'].join('\n'),
    },
    {
      path: 'posts/hello.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Hello', 'aliases:', '  - /hello-world', '---', '', '# Hello'].join('\n'),
    },
    {
      path: 'draft.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'draft: true', '---', '', '# Draft'].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/sitemap.xml', {
    draftMode: 'exclude',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      siteUrl: 'https://example.com',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/xml; charset=utf-8');
  const body = String(response.body);
  assert.match(body, /<loc>https:\/\/example\.com\/<\/loc>/);
  assert.match(body, /<loc>https:\/\/example\.com\/guides\/<\/loc>/);
  assert.match(body, /<loc>https:\/\/example\.com\/posts\/hello<\/loc>/);
  assert.doesNotMatch(body, /hello-world/);
  assert.doesNotMatch(body, /draft/);
  assert.match(body, /<lastmod>2026-03-20<\/lastmod>/);
  assert.match(body, /<lastmod>2026-03-21<\/lastmod>/);
});

test('handleSiteRequest returns an error for sitemap.xml when siteUrl is missing', async () => {
  const response = await handleSiteRequest(new MemoryContentStore([]), '/sitemap.xml', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 500);
  assert.match(String(response.body), /siteUrl/);
});

test('handleSiteRequest renders feed.xml for dated posts and adds autodiscovery link', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Home', 'summary: Site summary', '---', '', '# Home'].join('\n'),
    },
    {
      path: 'posts/new.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: New Post',
        'date: 2026-03-22',
        'summary: Fresh summary',
        '---',
        '',
        '# New Post',
      ].join('\n'),
    },
    {
      path: 'posts/old.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Old Post',
        'date: 2026-03-20',
        '---',
        '',
        'First paragraph excerpt.',
      ].join('\n'),
    },
    {
      path: 'guides/page.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Guide', 'date: 2026-03-21', 'type: page', '---', '', '# Guide'].join('\n'),
    },
    {
      path: 'draft.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Draft', 'date: 2026-03-23', 'draft: true', '---', '', '# Draft'].join('\n'),
    },
  ]);

  const siteConfig = {
    ...TEST_SITE_CONFIG,
    siteUrl: 'https://example.com',
    siteDescription: 'Configured site description',
  };

  const feedResponse = await handleSiteRequest(store, '/feed.xml', {
    draftMode: 'exclude',
    siteConfig,
  });

  assert.equal(feedResponse.status, 200);
  assert.equal(feedResponse.headers['content-type'], 'application/rss+xml; charset=utf-8');
  const feedBody = String(feedResponse.body);
  assert.match(feedBody, /<title>Test Site<\/title>/);
  assert.match(feedBody, /<link>https:\/\/example\.com<\/link>/);
  assert.match(feedBody, /<atom:link href="https:\/\/example\.com\/feed\.xml"/);
  assert.match(feedBody, /<title>New Post<\/title>[\s\S]*<title>Old Post<\/title>/);
  assert.match(feedBody, /<guid isPermaLink="true">https:\/\/example\.com\/posts\/new<\/guid>/);
  assert.match(feedBody, /<description>Fresh summary<\/description>/);
  assert.match(feedBody, /<description>First paragraph excerpt\.<\/description>/);
  assert.doesNotMatch(feedBody, /Guide/);
  assert.doesNotMatch(feedBody, /Draft/);

  const htmlResponse = await handleSiteRequest(store, '/posts/new.html', {
    draftMode: 'exclude',
    siteConfig,
  });
  assert.equal(htmlResponse.status, 200);
  assert.match(
    String(htmlResponse.body),
    /<link rel="alternate" type="application\/rss\+xml" title="Test Site" href="https:\/\/example\.com\/feed\.xml">/,
  );
});

test('handleSiteRequest returns 404 for feed.xml when siteUrl is missing or rss is disabled', async () => {
  const store = new MemoryContentStore([]);

  const missingSiteUrl = await handleSiteRequest(store, '/feed.xml', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(missingSiteUrl.status, 404);

  const disabledRss = await handleSiteRequest(store, '/feed.xml', {
    draftMode: 'exclude',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      siteUrl: 'https://example.com',
      rss: {
        enabled: false,
        maxItems: 20,
      },
    },
  });
  assert.equal(disabledRss.status, 404);
});

test('handleSiteRequest serves OpenAPI schema for search', async () => {
  const response = await handleSiteRequest(
    new MemoryContentStore([]),
    '/api/openapi.json',
    {
      draftMode: 'include',
      siteConfig: TEST_SITE_CONFIG,
      requestUrl: 'https://example.com/api/openapi.json',
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const body = JSON.parse(String(response.body)) as {
    openapi: string;
    paths: Record<string, unknown>;
  };
  assert.equal(body.openapi, '3.1.0');
  assert.ok('/api/search' in body.paths);
});

test('handleSiteRequest serves search API results', async () => {
  const response = await handleSiteRequest(
    new MemoryContentStore([]),
    '/api/search',
    {
      draftMode: 'include',
      siteConfig: TEST_SITE_CONFIG,
      searchParams: new URLSearchParams({
        q: 'cloudflare deploy',
        topK: '5',
        'meta.type': 'post',
        'meta.section': 'guides',
      }),
      searchApi: {
        async search(query, options) {
          assert.equal(query, 'cloudflare deploy');
          assert.equal(options?.topK, 5);
          assert.deepEqual(options?.metadata, {
            type: 'post',
            section: 'guides',
          });
          return [
            {
              docId: '/guides/cloudflare',
              relativePath: 'guides/cloudflare.md',
              canonicalUrl: 'https://example.com/guides/cloudflare',
              title: 'Cloudflare Deployment',
              summary: 'Deploy with Workers.',
              metadata: {},
              score: 0.9,
              bestMatch: {
                chunkId: 1,
                excerpt: 'Build a Worker bundle and deploy it.',
                headingPath: ['Cloudflare Deployment'],
                charStart: 0,
                charEnd: 35,
                score: 0.9,
              },
            },
          ];
        },
      },
    },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(String(response.body)) as {
    query: string;
    metadata?: Record<string, string>;
    count: number;
    hits: Array<{ title: string }>;
  };
  assert.equal(body.query, 'cloudflare deploy');
  assert.deepEqual(body.metadata, { type: 'post', section: 'guides' });
  assert.equal(body.count, 1);
  assert.equal(body.hits[0]?.title, 'Cloudflare Deployment');
});

test('handleSiteRequest uses site search topK when query topK is omitted', async () => {
  const response = await handleSiteRequest(
    new MemoryContentStore([]),
    '/api/search',
    {
      draftMode: 'include',
      siteConfig: {
        ...TEST_SITE_CONFIG,
        search: {
          topK: 7,
          mode: 'hybrid',
          minScore: 0.05,
        },
      },
      searchParams: new URLSearchParams({
        q: 'cloudflare deploy',
        'meta.type': 'post',
      }),
      searchApi: {
        async search(query, options) {
          assert.equal(query, 'cloudflare deploy');
          assert.equal(options?.topK, 7);
          assert.deepEqual(options?.metadata, {
            type: 'post',
          });
          assert.equal('mode' in (options ?? {}), false);
          return [];
        },
      },
    },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(String(response.body)) as {
    topK: number;
    metadata?: Record<string, string>;
    count: number;
  };
  assert.equal(body.topK, 7);
  assert.deepEqual(body.metadata, { type: 'post' });
  assert.equal(body.count, 0);
});

test('handleSiteRequest query topK overrides site search topK', async () => {
  const response = await handleSiteRequest(
    new MemoryContentStore([]),
    '/api/search',
    {
      draftMode: 'include',
      siteConfig: {
        ...TEST_SITE_CONFIG,
        search: {
          topK: 7,
          mode: 'vector',
        },
      },
      searchParams: new URLSearchParams({
        q: 'cloudflare deploy',
        topK: '3',
      }),
      searchApi: {
        async search(_query, options) {
          assert.equal(options?.topK, 3);
          assert.equal('mode' in (options ?? {}), false);
          return [];
        },
      },
    },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(String(response.body)) as {
    topK: number;
  };
  assert.equal(body.topK, 3);
});

test('handleSiteRequest renders search UI when search is enabled', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Home',
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
    searchApi: {
      async search() {
        return [];
      },
    },
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /data-site-search/);
  assert.match(String(response.body), /action="\/api\/search"/);
});

test('handleSiteRequest returns 404 for search API when disabled', async () => {
  const response = await handleSiteRequest(
    new MemoryContentStore([]),
    '/api/search',
    {
      draftMode: 'include',
      siteConfig: TEST_SITE_CONFIG,
      searchParams: new URLSearchParams({ q: 'hello' }),
    },
  );

  assert.equal(response.status, 404);
});

test('handleSiteRequest renders directory listings when index is missing', async () => {
  const store = new MemoryContentStore([
    {
      path: 'topic/post.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Post',
    },
    {
      path: 'topic/subtopic/note.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Note',
    },
    {
      path: 'topic/image.png',
      kind: 'binary',
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    },
  ]);

  const response = await handleSiteRequest(store, '/topic/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /href="\/topic\/post"/);
  assert.match(String(response.body), /href="\/topic\/subtopic\/"/);
  assert.doesNotMatch(String(response.body), /image\.png/);
});

test('handleSiteRequest serves mp4 assets with video content-type', async () => {
  const store = new MemoryContentStore([
    {
      path: 'videos/demo.mp4',
      kind: 'binary',
      mediaType: 'video/mp4',
      bytes: new Uint8Array([1, 2, 3, 4]),
    },
  ]);

  const response = await handleSiteRequest(store, '/videos/demo.mp4', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'video/mp4');
  assert.deepEqual(Array.from(response.body as Uint8Array), [1, 2, 3, 4]);
});

test('handleSiteRequest renders README.md as directory homepage fallback', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Root Readme', '---', '', '# Root Readme'].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /Root Readme/);
});

test('handleSiteRequest renders SKILL.md as directory homepage fallback', async () => {
  const store = new MemoryContentStore([
    {
      path: 'chrome-devtools/SKILL.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'name: chrome-devtools-mcp-skill',
        'description: Inspect pages and browser state.',
        '---',
        '',
        '# Chrome DevTools MCP Skill',
      ].join('\n'),
    },
  ]);

  const htmlResponse = await handleSiteRequest(store, '/chrome-devtools/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(htmlResponse.status, 200);
  assert.match(String(htmlResponse.body), /Chrome DevTools MCP Skill/);
  assert.match(
    String(htmlResponse.body),
    /<title>chrome-devtools-mcp-skill \| Test Site<\/title>/,
  );

  const markdownResponse = await handleSiteRequest(store, '/chrome-devtools/SKILL.md', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(markdownResponse.status, 200);
  assert.match(String(markdownResponse.body), /^---/m);
});

test('handleSiteRequest redirects extensionless directory homepage requests to trailing slash', async () => {
  const store = new MemoryContentStore([
    {
      path: 'guides/README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Guides', '---', '', '# Guides'].join('\n'),
    },
    {
      path: 'browse/intro.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Intro',
    },
  ]);

  const directoryHomepage = await handleSiteRequest(store, '/guides', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(directoryHomepage.status, 308);
  assert.equal(directoryHomepage.headers.location, '/guides/');

  const directoryListing = await handleSiteRequest(store, '/browse', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(directoryListing.status, 308);
  assert.equal(directoryListing.headers.location, '/browse/');
});

test('handleSiteRequest redirects alternate directory markdown filenames', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Root Readme', '---', '', '# Root Readme'].join('\n'),
    },
    {
      path: 'guides/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Guides', '---', '', '# Guides'].join('\n'),
    },
  ]);

  const rootRedirect = await handleSiteRequest(store, '/index.md', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(rootRedirect.status, 308);
  assert.equal(rootRedirect.headers.location, '/README.md');

  const guidesRedirect = await handleSiteRequest(store, '/guides/README.md', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(guidesRedirect.status, 308);
  assert.equal(guidesRedirect.headers.location, '/guides/index.md');
});

test('handleSiteRequest redirects aliases to canonical html paths', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '# Home',
    },
    {
      path: 'guides/README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'aliases:', '  - /old-guides', '---', '', '# Guides'].join('\n'),
    },
    {
      path: 'posts/hello.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'aliases:', '  - /hello-world', '---', '', '# Hello'].join('\n'),
    },
  ]);

  const directoryAlias = await handleSiteRequest(store, '/old-guides', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(directoryAlias.status, 308);
  assert.equal(directoryAlias.headers.location, '/guides/');

  const articleAlias = await handleSiteRequest(store, '/hello-world', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(articleAlias.status, 308);
  assert.equal(articleAlias.headers.location, '/posts/hello');
});

test('handleSiteRequest does not redirect draft aliases in exclude mode', async () => {
  const store = new MemoryContentStore([
    {
      path: 'draft.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'draft: true', 'aliases:', '  - /old-draft', '---', '', '# Draft'].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/old-draft', {
    draftMode: 'exclude',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 404);
});

test('handleSiteRequest derives top navigation from root directories when topNav is empty', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Root Readme', '---', '', '# Root Readme'].join('\n'),
    },
    {
      path: 'guides/README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Guides', 'type: page', 'order: 20', '---', '', '# Guides'].join('\n'),
    },
    {
      path: 'reference/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Reference', 'type: page', 'order: 30', '---', '', '# Reference'].join('\n'),
    },
    {
      path: 'about/README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: About', 'type: page', 'order: 10', '---', '', '# About'].join('\n'),
    },
    {
      path: 'post/README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Post', 'type: post', 'date: 2026-03-20', '---', '', '# Post'].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      topNav: [],
      showHomeIndex: true,
    },
  });

  assert.equal(response.status, 200);
  const body = String(response.body);
  assert.ok(body.indexOf('/about/') < body.indexOf('/guides/'));
  assert.ok(body.indexOf('/guides/') < body.indexOf('/reference/'));
  assert.match(String(response.body), /href="\/guides\/"/);
  assert.match(String(response.body), />Guides<\/a>/);
  assert.match(String(response.body), /href="\/reference\/"/);
  assert.match(String(response.body), />Reference<\/a>/);
  assert.doesNotMatch(String(response.body), /href="\/post\/"/);
});

test('handleSiteRequest hides home index block in html when showHomeIndex is false', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Root Readme',
        'summary: Root summary',
        '---',
        '',
        '# Root Readme',
        '',
        'Intro text.',
        '',
        '<!-- INDEX:START -->',
        '',
        '- [About](./about/)',
        '',
        '<!-- INDEX:END -->',
      ].join('\n'),
    },
  ]);

  const htmlResponse = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      topNav: [{ label: 'About', href: '/about/' }],
      showHomeIndex: false,
    },
  });

  assert.equal(htmlResponse.status, 200);
  assert.match(String(htmlResponse.body), /Intro text/);
  assert.match(String(htmlResponse.body), /href="\/about\/"/);
  assert.doesNotMatch(String(htmlResponse.body), /<!-- INDEX:START -->/);

  const markdownResponse = await handleSiteRequest(store, '/README.md', {
    draftMode: 'include',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      topNav: [{ label: 'About', href: '/about/' }],
      showHomeIndex: false,
    },
  });

  assert.match(String(markdownResponse.body), /<!-- INDEX:START -->/);
});

test('handleSiteRequest hides root index entries that are already present in navigation', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Root Readme',
        '---',
        '',
        '# Root Readme',
        '',
        '<!-- INDEX:START -->',
        '',
        '- [Guides](./guides/)',
        '  2026-03-20 · Guides summary.',
        '',
        '- [Why mdorigin exists](./why-mdorigin.md)',
        '  2026-03-20 · Post summary.',
        '',
        '<!-- INDEX:END -->',
      ].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      topNav: [{ label: 'Guides', href: '/guides/' }],
    },
  });

  assert.equal(response.status, 200);
  assert.doesNotMatch(String(response.body), /<a href="\.\/guides\/">Guides<\/a>/);
  assert.match(String(response.body), /Why mdorigin exists/);
});

test('handleSiteRequest respects site config rendering options', async () => {
  const store = new MemoryContentStore([
    {
      path: 'post.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Configured Post',
        'date: 2026-03-20',
        'summary: Hidden summary',
        '---',
        '',
        'Body text',
      ].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/post', {
    draftMode: 'include',
    siteConfig: {
      siteTitle: 'Configured Site',
      siteDescription: 'Configured description',
      siteUrl: 'https://example.com',
      favicon: '/favicon.ico',
      socialImage: '/og.svg',
      logo: { src: '/logo.svg', alt: 'Configured Site' },
      showDate: false,
      showSummary: false,
      topNav: [{ label: 'Docs', href: '/docs/' }],
      footerNav: [{ label: 'GitHub', href: 'https://github.com/example/repo' }],
      footerText: 'Footer note',
      socialLinks: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/example/repo' }],
      editLink: { baseUrl: 'https://github.com/example/repo/edit/main/docs/' },
      showHomeIndex: true,
      listingInitialPostCount: 10,
      listingLoadMoreStep: 10,
      stylesheetContent: 'body { color: red; }',
      siteTitleConfigured: true,
      siteDescriptionConfigured: true,
    },
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /Configured Site/);
  assert.match(String(response.body), /Configured description/);
  assert.match(String(response.body), /href="\/docs\/"/);
  assert.doesNotMatch(String(response.body), /href="\/guides\/"/);
  assert.match(String(response.body), /body \{ color: red; \}/);
  assert.match(String(response.body), /rel="canonical" href="https:\/\/example\.com\/post"/);
  assert.match(String(response.body), /rel="icon" href="\/favicon\.ico"/);
  assert.match(
    String(response.body),
    /property="og:image" content="https:\/\/example\.com\/og\.svg"/,
  );
  assert.match(
    String(response.body),
    /name="twitter:image" content="https:\/\/example\.com\/og\.svg"/,
  );
  assert.match(
    String(response.body),
    /rel="alternate" type="text\/markdown" href="\/post\.md"/,
  );
  assert.match(
    String(response.body),
    /class="site-footer__markdown-link" href="\/post\.md" aria-label="View Markdown source">MD View</,
  );
  assert.match(String(response.body), /<img src="\/logo\.svg" alt="Configured Site">/);
  assert.match(String(response.body), /site-footer__nav/);
  assert.match(String(response.body), /Footer note/);
  assert.match(String(response.body), /Edit this page/);
  assert.doesNotMatch(String(response.body), /Hidden summary/);
  assert.doesNotMatch(String(response.body), /2026-03-20/);
});

test('handleSiteRequest uses skill metadata fallbacks and serves script files as text', async () => {
  const store = new MemoryContentStore([
    {
      path: 'skill/SKILL.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'name: find-skills',
        'description: Discover skills from the ecosystem.',
        '---',
        '',
        '# Find Skills',
        '',
        'This skill helps you discover installable skills.',
      ].join('\n'),
    },
    {
      path: 'skill/scripts/install.sh',
      kind: 'text',
      mediaType: 'text/plain; charset=utf-8',
      text: '#!/usr/bin/env bash\necho install\n',
    },
  ]);

  const response = await handleSiteRequest(store, '/skill/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /Discover skills from the ecosystem\./);
  assert.match(String(response.body), /<title>find-skills \| Test Site<\/title>/);

  const scriptResponse = await handleSiteRequest(store, '/skill/scripts/install.sh', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });
  assert.equal(scriptResponse.status, 200);
  assert.equal(scriptResponse.headers['content-type'], 'text/plain; charset=utf-8');
  assert.match(String(scriptResponse.body), /echo install/);
});

test('handleSiteRequest renders yaml dates parsed as Date objects', async () => {
  const store = new MemoryContentStore([
    {
      path: 'dated.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['---', 'title: Dated Post', 'date: 2026-03-20', '---', '', '# Dated'].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/dated', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /<title>Dated Post \| Test Site<\/title>/);
  assert.match(String(response.body), /<h1>Dated<\/h1>/);
});

test('handleSiteRequest renders managed index blocks with default listing layout', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Catalog Home',
        '---',
        '',
        '# Catalog Home',
        '',
        'Body paragraph.',
        '',
        '## Start Here',
        '',
        '- [Manual Link](./guides/)',
        '',
        '<!-- INDEX:START -->',
        '',
        '- [Guides](./guides/)',
        '',
        '- [Reference](./reference/)',
        '',
        '- [Why mdorigin exists](./why-mdorigin.md)',
        '  2026-03-20 · A concise explanation of the project.',
        '',
        '<!-- INDEX:END -->',
      ].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: TEST_SITE_CONFIG,
  });

  assert.equal(response.status, 200);
  assert.match(String(response.body), /<h1>Catalog Home<\/h1>/);
  assert.equal((String(response.body).match(/<h1/g) ?? []).length, 1);
  assert.match(String(response.body), /Body paragraph\./);
  assert.match(String(response.body), /<a class="catalog-item catalog-item--directory" href="\.\/guides\/">/);
  assert.match(String(response.body), /<a class="catalog-item catalog-item--directory" href="\.\/reference\/">/);
  assert.match(String(response.body), /<a class="catalog-item" href="\.\/why-mdorigin">/);
  assert.match(String(response.body), /A concise explanation of the project\./);
  assert.match(String(response.body), /<li><a href="\.\/guides\/">Manual Link<\/a><\/li>/);
  assert.doesNotMatch(String(response.body), /<li><a href="\.\/reference\/">Reference<\/a><\/li>/);
  assert.doesNotMatch(String(response.body), /Directory<\/span>/);
});

test('handleSiteRequest loads additional listing articles in batches', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Catalog Home',
        '---',
        '',
        '# Catalog Home',
        '',
        '<!-- INDEX:START -->',
        '',
        '- [First](./first.md)',
        '  First detail.',
        '',
        '- [Second](./second.md)',
        '  Second detail.',
        '',
        '- [Third](./third.md)',
        '  Third detail.',
        '',
        '<!-- INDEX:END -->',
      ].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      listingInitialPostCount: 1,
      listingLoadMoreStep: 1,
    },
  });

  assert.equal(response.status, 200);
  const body = String(response.body);
  assert.match(body, /First/);
  assert.doesNotMatch(body, /Second detail\./);
  assert.match(body, /data-listing-load-more/);

  const fragmentResponse = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      listingInitialPostCount: 1,
      listingLoadMoreStep: 1,
    },
    searchParams: new URLSearchParams({
      'listing-format': 'posts',
      'listing-offset': '1',
      'listing-limit': '1',
    }),
  });

  assert.equal(fragmentResponse.status, 200);
  assert.equal(
    fragmentResponse.headers['content-type'],
    'application/json; charset=utf-8',
  );
  const payload = JSON.parse(String(fragmentResponse.body)) as {
    itemsHtml: string;
    hasMore: boolean;
    nextOffset: number;
  };
  assert.match(payload.itemsHtml, /Second/);
  assert.equal(payload.hasMore, true);
  assert.equal(payload.nextOffset, 2);
});

test('handleSiteRequest paginates post directory bundles in default listing layout', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Catalog Home',
        '---',
        '',
        '# Catalog Home',
        '',
        '<!-- INDEX:START -->',
        '',
        '- [Post A](./post-a/)',
        '  2026-03-28 · First bundled post.',
        '  <!-- mdorigin:index kind=article -->',
        '',
        '- [Post B](./post-b/)',
        '  2026-03-27 · Second bundled post.',
        '  <!-- mdorigin:index kind=article -->',
        '',
        '<!-- INDEX:END -->',
      ].join('\n'),
    },
  ]);

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      listingInitialPostCount: 1,
      listingLoadMoreStep: 1,
    },
  });

  assert.equal(response.status, 200);
  const body = String(response.body);
  assert.match(body, /Post A/);
  assert.doesNotMatch(body, /Second bundled post\./);
  assert.match(body, /data-listing-load-more/);

  const fragmentResponse = await handleSiteRequest(store, '/', {
    draftMode: 'include',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      listingInitialPostCount: 1,
      listingLoadMoreStep: 1,
    },
    searchParams: new URLSearchParams({
      'listing-format': 'posts',
      'listing-offset': '1',
      'listing-limit': '1',
    }),
  });

  assert.equal(fragmentResponse.status, 200);
  const payload = JSON.parse(String(fragmentResponse.body)) as {
    itemsHtml: string;
    hasMore: boolean;
    nextOffset: number;
  };
  assert.match(payload.itemsHtml, /Post B/);
  assert.equal(payload.hasMore, false);
  assert.equal(payload.nextOffset, 2);
});

test('handleSiteRequest renders built-in chrome with the configured locale', async () => {
  const store = new MemoryContentStore([
    {
      path: 'topic/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: ['# Topic', '', 'Hello.', ''].join('\n'),
    },
    {
      path: 'empty-dir/.gitkeep',
      kind: 'text',
      mediaType: 'text/plain; charset=utf-8',
      text: '',
    },
  ]);
  const searchApi = {
    search: async () => [],
  };

  const pageResponse = await handleSiteRequest(store, '/topic/', {
    draftMode: 'exclude',
    siteConfig: { ...TEST_SITE_CONFIG, locale: 'zh-CN' },
    searchApi,
  });

  assert.equal(pageResponse.status, 200);
  const pageBody = String(pageResponse.body);
  assert.match(pageBody, /<html lang="zh-CN">/);
  assert.match(pageBody, /class="site-search__toggle"[^>]*>搜索</);
  assert.match(pageBody, /placeholder="搜索文档与技能"/);
  assert.match(pageBody, /aria-label="查看 Markdown 源文件"/);
  assert.match(pageBody, />MD 视图</);
  assert.doesNotMatch(pageBody, />Search</);
  assert.match(pageBody, /const M = \{"resultsEmpty":"没有找到结果。"/);

  const notFoundResponse = await handleSiteRequest(store, '/missing', {
    draftMode: 'exclude',
    siteConfig: { ...TEST_SITE_CONFIG, locale: 'zh-CN' },
    searchApi,
  });

  assert.equal(notFoundResponse.status, 404);
  const notFoundBody = String(notFoundResponse.body);
  assert.match(notFoundBody, /<html lang="zh-CN">/);
  assert.match(notFoundBody, /<h1>未找到<\/h1>/);
  assert.match(notFoundBody, /没有页面发布在 <code>\/missing<\/code>/);
  assert.match(notFoundBody, /<title>未找到 \| Test Site<\/title>/);
});

test('handleSiteRequest applies user message overrides and unknown locales fall back to english', async () => {
  const store = new MemoryContentStore([]);

  const overridden = await handleSiteRequest(store, '/missing', {
    draftMode: 'exclude',
    siteConfig: {
      ...TEST_SITE_CONFIG,
      locale: 'en',
      messages: { 'error.notFoundTitle': 'Oops' },
    },
  });
  assert.match(String(overridden.body), /<h1>Oops<\/h1>/);
  assert.match(String(overridden.body), /No page was published at/);

  const unknownLocale = await handleSiteRequest(store, '/missing', {
    draftMode: 'exclude',
    siteConfig: { ...TEST_SITE_CONFIG, locale: 'xx-YY' },
  });
  assert.match(String(unknownLocale.body), /<html lang="xx-YY">/);
  assert.match(String(unknownLocale.body), /<h1>Not Found<\/h1>/);
});

const MULTI_LOCALE_SITE_CONFIG = {
  ...TEST_SITE_CONFIG,
  siteUrl: 'https://example.com',
  locales: [
    {
      code: 'en',
      label: 'English',
      pathPrefix: '',
      isDefault: true,
      contentBase: '',
      messages: {},
      topNav: [],
      footerNav: [],
    },
    {
      code: 'zh-CN',
      label: '中文',
      pathPrefix: '/zh-CN',
      isDefault: false,
      contentBase: 'zh-CN',
      messages: {},
      topNav: [],
      footerNav: [],
    },
  ],
};

function createMultiLocaleStore() {
  return new MemoryContentStore([
    {
      path: 'index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: Home\n---\n\nEnglish home.\n',
    },
    {
      path: 'docs/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: Docs\norder: 1\n---\n\nEnglish docs.\n',
    },
    {
      path: 'hello.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: English Post\ndate: 2024-05-01\n---\n\nEnglish post body.\n',
    },
    {
      path: 'about.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: About\n---\n\nAbout this site.\n',
    },
    {
      path: 'zh-CN/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: 首页\n---\n\n中文首页。\n',
    },
    {
      path: 'zh-CN/docs/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: 文档\norder: 1\n---\n\n中文文档。\n',
    },
    {
      path: 'zh-CN/hello.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: 中文文章\ndate: 2024-05-02\n---\n\n中文文章正文。\n',
    },
  ]);
}

test('matchRequestLocale attributes paths to configured locales', async () => {
  const { matchRequestLocale } = await import('./router.js');
  const locales = MULTI_LOCALE_SITE_CONFIG.locales;

  assert.equal(matchRequestLocale('/zh-CN/docs/', locales)?.code, 'zh-CN');
  assert.equal(matchRequestLocale('/zh-CN', locales)?.code, 'zh-CN');
  assert.equal(matchRequestLocale('/docs/', locales)?.code, 'en');
  assert.equal(matchRequestLocale('/', locales)?.code, 'en');
  assert.equal(matchRequestLocale('/zh-CNx/', locales)?.code, 'en');
  assert.equal(matchRequestLocale('/zh-CN/', undefined), null);
});

test('handleSiteRequest renders locale pages with language chrome', async () => {
  const store = createMultiLocaleStore();
  const searchApi = { search: async () => [] };

  const zhResponse = await handleSiteRequest(store, '/zh-CN/docs/', {
    draftMode: 'exclude',
    siteConfig: MULTI_LOCALE_SITE_CONFIG,
    searchApi,
  });

  assert.equal(zhResponse.status, 200);
  const zhBody = String(zhResponse.body);
  assert.match(zhBody, /<html lang="zh-CN">/);
  assert.match(zhBody, /中文文档。/);
  assert.match(zhBody, /class="site-search__toggle"[^>]*>搜索</);
  assert.match(
    zhBody,
    /<a href="\/docs\/" hreflang="en">English<\/a>/,
  );
  assert.match(
    zhBody,
    /<a href="\/zh-CN\/docs\/" hreflang="zh-CN" aria-current="page">中文<\/a>/,
  );
  assert.match(
    zhBody,
    /<link rel="alternate" hreflang="en" href="https:\/\/example\.com\/docs\/">/,
  );
  assert.match(
    zhBody,
    /<link rel="alternate" hreflang="zh-CN" href="https:\/\/example\.com\/zh-CN\/docs\/">/,
  );
  assert.match(
    zhBody,
    /<link rel="alternate" hreflang="x-default" href="https:\/\/example\.com\/docs\/">/,
  );
  assert.match(zhBody, /<link rel="canonical" href="https:\/\/example\.com\/zh-CN\/docs\/">/);
  assert.match(zhBody, /"include":"zh-CN\/","exclude":\[\]/);

  const enResponse = await handleSiteRequest(store, '/docs/', {
    draftMode: 'exclude',
    siteConfig: MULTI_LOCALE_SITE_CONFIG,
    searchApi,
  });

  assert.equal(enResponse.status, 200);
  const enBody = String(enResponse.body);
  assert.match(enBody, /<html lang="en">/);
  assert.match(enBody, /<a href="\/zh-CN\/docs\/" hreflang="zh-CN">中文<\/a>/);
  assert.match(enBody, /"include":"","exclude":\["zh-CN\/"\]/);
});

test('handleSiteRequest keeps untranslated locale pages out of the switcher', async () => {
  const store = createMultiLocaleStore();
  const searchApi = { search: async () => [] };

  const response = await handleSiteRequest(store, '/about', {
    draftMode: 'exclude',
    siteConfig: MULTI_LOCALE_SITE_CONFIG,
    searchApi,
  });

  assert.equal(response.status, 200);
  const body = String(response.body);
  assert.match(body, /<a href="\/about" hreflang="en" aria-current="page">English<\/a>/);
  assert.match(body, /<a href="\/zh-CN\/" hreflang="zh-CN">中文<\/a>/);
  assert.doesNotMatch(body, /hreflang="zh-CN" href="https:\/\/example\.com\/zh-CN\/about"/);
});

test('handleSiteRequest renders locale-aware 404 pages', async () => {
  const store = createMultiLocaleStore();

  const response = await handleSiteRequest(store, '/zh-CN/missing', {
    draftMode: 'exclude',
    siteConfig: MULTI_LOCALE_SITE_CONFIG,
  });

  assert.equal(response.status, 404);
  const body = String(response.body);
  assert.match(body, /<html lang="zh-CN">/);
  assert.match(body, /<h1>未找到<\/h1>/);
  assert.match(body, /没有页面发布在 <code>\/zh-CN\/missing<\/code>/);
});

test('handleSiteRequest serves per-locale rss feeds', async () => {
  const store = createMultiLocaleStore();

  const defaultFeed = await handleSiteRequest(store, '/feed.xml', {
    draftMode: 'exclude',
    siteConfig: MULTI_LOCALE_SITE_CONFIG,
  });
  assert.equal(defaultFeed.status, 200);
  const defaultBody = String(defaultFeed.body);
  assert.match(defaultBody, /English Post/);
  assert.doesNotMatch(defaultBody, /中文文章/);
  assert.match(defaultBody, /<atom:link href="https:\/\/example\.com\/feed\.xml"/);

  const zhFeed = await handleSiteRequest(store, '/zh-CN/feed.xml', {
    draftMode: 'exclude',
    siteConfig: MULTI_LOCALE_SITE_CONFIG,
  });
  assert.equal(zhFeed.status, 200);
  const zhBody = String(zhFeed.body);
  assert.match(zhBody, /中文文章/);
  assert.doesNotMatch(zhBody, /English Post/);
  assert.match(zhBody, /<atom:link href="https:\/\/example\.com\/zh-CN\/feed\.xml"/);
});

test('handleSiteRequest excludes locale directories from the auto top nav', async () => {
  const store = createMultiLocaleStore();

  const response = await handleSiteRequest(store, '/', {
    draftMode: 'exclude',
    siteConfig: MULTI_LOCALE_SITE_CONFIG,
  });

  assert.equal(response.status, 200);
  const body = String(response.body);
  assert.match(body, /<a href="\/docs\/">/);
  assert.doesNotMatch(body, /<li><a href="\/zh-CN\/">/);
});

test('handleSiteRequest generates locale-scoped auto top nav', async () => {
  const store = createMultiLocaleStore();

  const zhResponse = await handleSiteRequest(store, '/zh-CN/', {
    draftMode: 'exclude',
    siteConfig: MULTI_LOCALE_SITE_CONFIG,
  });

  assert.equal(zhResponse.status, 200);
  const zhBody = String(zhResponse.body);
  assert.match(zhBody, /<li><a href="\/zh-CN\/docs\/">文档<\/a><\/li>/);
  assert.doesNotMatch(zhBody, /<li><a href="\/docs\/">/);
});

test('handleSiteRequest applies locale siteTitle and siteDescription overrides', async () => {
  const store = createMultiLocaleStore();
  const siteConfig = {
    ...MULTI_LOCALE_SITE_CONFIG,
    siteDescription: 'Global description',
    locales: [
      MULTI_LOCALE_SITE_CONFIG.locales[0],
      {
        ...MULTI_LOCALE_SITE_CONFIG.locales[1],
        siteTitle: '中文测试站',
        siteDescription: '中文站点描述',
      },
    ],
  };

  const zhResponse = await handleSiteRequest(store, '/zh-CN/', {
    draftMode: 'exclude',
    siteConfig,
  });
  const zhBody = String(zhResponse.body);
  assert.match(zhBody, /<title>首页 \| 中文测试站<\/title>/);
  assert.match(zhBody, /<span>中文站点描述<\/span>/);

  const enResponse = await handleSiteRequest(store, '/', {
    draftMode: 'exclude',
    siteConfig,
  });
  const enBody = String(enResponse.body);
  assert.match(enBody, /<title>Home \| Test Site<\/title>/);
  assert.match(enBody, /<span>Global description<\/span>/);

  const zhFeed = await handleSiteRequest(store, '/zh-CN/feed.xml', {
    draftMode: 'exclude',
    siteConfig,
  });
  assert.match(String(zhFeed.body), /<title>中文测试站<\/title>/);
});

test('handleSiteRequest prefers locale topNav overrides', async () => {
  const store = createMultiLocaleStore();
  const siteConfig = {
    ...MULTI_LOCALE_SITE_CONFIG,
    topNav: [{ label: 'Global', href: '/global/' }],
    locales: [
      MULTI_LOCALE_SITE_CONFIG.locales[0],
      {
        ...MULTI_LOCALE_SITE_CONFIG.locales[1],
        topNav: [{ label: '中文导航', href: '/zh-CN/nav/' }],
      },
    ],
  };

  const enResponse = await handleSiteRequest(store, '/', {
    draftMode: 'exclude',
    siteConfig,
  });
  assert.match(String(enResponse.body), /<li><a href="\/global\/">Global<\/a><\/li>/);

  const zhResponse = await handleSiteRequest(store, '/zh-CN/', {
    draftMode: 'exclude',
    siteConfig,
  });
  const zhBody = String(zhResponse.body);
  assert.match(zhBody, /<li><a href="\/zh-CN\/nav\/">中文导航<\/a><\/li>/);
  assert.doesNotMatch(zhBody, /\/global\//);
});

test('handleSiteRequest redirects root to a prefixed default locale', async () => {
  const store = new MemoryContentStore([
    {
      path: 'en/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: Home\n---\n\nEnglish home.\n',
    },
    {
      path: 'zh/index.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: '---\ntitle: 首页\n---\n\n中文首页。\n',
    },
  ]);
  const siteConfig = {
    ...MULTI_LOCALE_SITE_CONFIG,
    locales: [
      {
        code: 'en',
        label: 'English',
        pathPrefix: '/en',
        isDefault: true,
        contentBase: 'en',
        messages: {},
        topNav: [],
        footerNav: [],
      },
      {
        code: 'zh',
        label: '中文',
        pathPrefix: '/zh',
        isDefault: false,
        contentBase: 'zh',
        messages: {},
        topNav: [],
        footerNav: [],
      },
    ],
  };

  const rootResponse = await handleSiteRequest(store, '/', {
    draftMode: 'exclude',
    siteConfig,
  });
  assert.equal(rootResponse.status, 308);
  assert.equal(rootResponse.headers.location, '/en/');

  const enResponse = await handleSiteRequest(store, '/en/', {
    draftMode: 'exclude',
    siteConfig,
  });
  assert.equal(enResponse.status, 200);
  assert.match(String(enResponse.body), /English home\./);
});
