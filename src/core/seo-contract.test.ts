import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryContentStore, type ContentEntry } from './content-store.js';
import { handleSiteRequest } from './request-handler.js';
import { getSearchContentRevision, resolveSearchCitation } from './search-citations.js';
import type { ResolvedSiteConfig } from './site-config.js';
import type { SearchApi, SearchHit } from '../search.js';
import { createCloudflareWorker } from '../adapters/cloudflare.js';

const config: ResolvedSiteConfig = {
  siteTitle: 'Example', siteDescription: 'Site fallback', siteUrl: 'https://example.com',
  locale: 'en', messages: {}, showDate: true, showSummary: true,
  topNav: [], footerNav: [], socialLinks: [], showHomeIndex: true,
  listingInitialPostCount: 2, listingLoadMoreStep: 2,
  siteTitleConfigured: true, siteDescriptionConfigured: true,
};
const entry = (path: string, text: string): ContentEntry => ({
  path, text, kind: 'text', mediaType: path.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
});

test('presentation flags retain content metadata for templates and extension hooks', async () => {
  const store = new MemoryContentStore([entry('page.md', '---\nsummary: Page abstract\ndate: 2026-01-01\n---\n# Page')]);
  for (const show of [true, false]) {
    const result = await handleSiteRequest(store, '/page', {
      draftMode: 'exclude', siteConfig: { ...config, showSummary: show, showDate: show },
      plugins: [{
        name: 'presentation-contract',
        renderHeader({ page }) {
          assert.equal(page.summary, 'Page abstract');
          assert.equal(page.date, '2026-01-01');
          return page.showSummary ? '<p class="visible-summary">Page abstract</p>' : '';
        },
      }],
    });
    assert.match(String(result.body), /<meta name="description" content="Page abstract">/);
    assert.match(String(result.body), /og:description" content="Page abstract"/);
    assert.equal(String(result.body).includes('class="visible-summary"'), show);
  }
  const empty = await handleSiteRequest(new MemoryContentStore([entry('page.md', '---\ntitle: Empty\n---\n')]), '/page', {
    draftMode: 'exclude', siteConfig: config,
  });
  assert.match(String(empty.body), /name="description" content="Site fallback"/);
});

test('HTML and Markdown representations share robots and canonical headers, including directory entries', async () => {
  const frontmatter = '---\nrobots: { index: false, follow: true, maxSnippet: 120 }\naliases: [/old]\n---\n# Private';
  const store = new MemoryContentStore([
    entry('note.md', frontmatter), entry('topic/README.md', frontmatter),
    entry('bundle/SKILL.md', frontmatter), entry('README.md', frontmatter),
    entry('draft.md', '---\ndraft: true\n---\n# Draft'),
  ]);
  for (const [href, canonical] of [
    ['/note', '/note'], ['/note.html', '/note'], ['/note.md', '/note'],
    ['/topic/', '/topic/'], ['/topic/README.md', '/topic/'],
    ['/bundle/', '/bundle/'], ['/bundle/SKILL.md', '/bundle/'], ['/', '/'], ['/README.md', '/'],
  ]) {
    for (const acceptHeader of [undefined, 'text/markdown']) {
      const result = await handleSiteRequest(store, href, { draftMode: 'exclude', siteConfig: config, acceptHeader });
      assert.equal(result.status, 200, href);
      assert.equal(result.headers['x-robots-tag'], 'noindex, follow, max-snippet:120', href);
      assert.match(result.headers.link, new RegExp(`<https://example.com${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>; rel="canonical"`));
      if (result.headers['content-type'].startsWith('text/html')) {
        assert.match(String(result.body), /name="robots" content="noindex, follow, max-snippet:120"/);
      }
    }
  }
  const missing = await handleSiteRequest(store, '/draft.md', { draftMode: 'exclude', siteConfig: config });
  assert.equal(missing.status, 404);
  const alias = await handleSiteRequest(store, '/old', { draftMode: 'exclude', siteConfig: config });
  assert.equal(alias.status, 308);
  assert.ok(alias.headers.location);
});

test('sitemap modification dates and agent discovery exclude unpublished and noindex pages', async () => {
  const store = new MemoryContentStore([
    entry('README.md', '# Home'),
    entry('guide.md', '---\ndate: 2026-01-01\nupdated: "2026-10-21T15:30:00+08:00"\n---\n# Guide'),
    entry('old.md', '---\ndate: 2026-02-01\nupdated: "bad"\n---\n# Old'),
    entry('unknown.md', '---\ndate: "invalid"\n---\n# Unknown'),
    entry('hidden.md', '---\nnoindex: true\n---\n# Hidden'),
    entry('draft.md', '---\ndraft: true\n---\n# Draft'),
    entry('zh-CN/README.md', '# 中文'),
  ]);
  const options = { draftMode: 'exclude' as const, siteConfig: { ...config, llmsTxt: true } };
  const sitemap = await handleSiteRequest(store, '/sitemap.xml', options);
  assert.match(String(sitemap.body), /<lastmod>2026-10-21T07:30:00.000Z<\/lastmod>/);
  assert.match(String(sitemap.body), /<lastmod>2026-02-01<\/lastmod>/);
  assert.doesNotMatch(String(sitemap.body), /hidden|draft|invalid|<lastmod>bad/);
  const llms = await handleSiteRequest(store, '/llms.txt', { ...options, draftMode: 'include' });
  assert.equal(llms.status, 200);
  assert.doesNotMatch(String(llms.body), /hidden|draft/);
  assert.ok(new TextEncoder().encode(String(llms.body)).byteLength <= 32_000);
  for (const match of String(llms.body).matchAll(/\]\(<https:\/\/example.com([^>]+)>\)/g)) {
    const raw = await handleSiteRequest(store, match[1], options);
    assert.equal(raw.status, 200, match[1]);
    assert.match(raw.headers['content-type'], /text\/markdown/);
  }
  const html = await handleSiteRequest(store, '/guide', options);
  assert.match(html.headers.link, /rel="describedby"/);
  assert.match(String(html.body), /rel="describedby" type="text\/plain" href="\/llms.txt"/);
  const disabled = await handleSiteRequest(store, '/llms.txt', { ...options, siteConfig: config });
  assert.equal(disabled.status, 404);
});

test('user-owned discovery files win; crawler training policy requires explicit configuration', async () => {
  const custom = new MemoryContentStore([entry('robots.txt', 'custom robots'), entry('llms.txt', 'custom llms')]);
  for (const file of ['robots', 'llms']) {
    const response = await handleSiteRequest(custom, `/${file}.txt`, {
      draftMode: 'exclude', siteConfig: { ...config, llmsTxt: true, robots: { rules: [{ userAgent: 'GPTBot', disallow: ['/'] }] } },
    });
    assert.equal(response.body, `custom ${file}`);
  }
  const empty = new MemoryContentStore([]);
  const implicit = await handleSiteRequest(empty, '/robots.txt', { draftMode: 'exclude', siteConfig: config });
  assert.equal(implicit.body, 'Sitemap: https://example.com/sitemap.xml\n');
  const explicit = await handleSiteRequest(empty, '/robots.txt', {
    draftMode: 'exclude', siteConfig: { ...config, robots: { rules: [
      { userAgent: 'GPTBot', disallow: ['/'] }, { userAgent: 'OAI-SearchBot', allow: ['/'] },
    ] } },
  });
  assert.match(String(explicit.body), /User-agent: GPTBot\nDisallow: \//);
  assert.match(String(explicit.body), /User-agent: OAI-SearchBot\nAllow: \//);
});

test('search citations map actual chunk offsets to rendered duplicate and multilingual heading IDs', async () => {
  const body = '# Guide\n\n## 安装 `node`\n\nFirst.\n\n## 安装 `node`\n\nSecond command.';
  const contentRevision = await getSearchContentRevision(body);
  const searchApi: SearchApi = {
    async search() {
      return [{
        docId: '/guide', relativePath: 'guide.md', canonicalUrl: 'https://example.com/guide',
        metadata: { contentRevision }, score: 1,
        bestMatch: { chunkId: 1, excerpt: 'Second command.', headingPath: ['Guide', '安装 node'],
          charStart: new TextEncoder().encode(body.slice(0, body.indexOf('Second command'))).byteLength,
          charEnd: new TextEncoder().encode(body).byteLength, score: 1 },
      }];
    },
  };
  const store = new MemoryContentStore([entry('guide.md', body)]);
  const result = await handleSiteRequest(store, '/api/search', {
    draftMode: 'exclude', siteConfig: config, searchApi, searchParams: new URLSearchParams({ q: 'command' }),
  });
  const hit = JSON.parse(String(result.body)).hits[0];
  assert.equal(hit.canonicalUrl, 'https://example.com/guide');
  assert.equal(hit.citationUrl, `https://example.com/guide#${encodeURIComponent('安装-node-1')}`);
  assert.equal(hit.metadata.headings, undefined, 'internal mapping should not inflate API response bodies');
  const page = await handleSiteRequest(store, '/guide', { draftMode: 'exclude', siteConfig: config });
  assert.ok(String(page.body).includes(`id="${decodeURIComponent(new URL(hit.citationUrl).hash.slice(1))}"`));
});

test('no-JS pagination traverses every article with self canonicals and real prev/next links', async () => {
  const store = new MemoryContentStore([entry('blog/README.md', [
    '# Blog', '', '<!-- INDEX:START -->',
    ...Array.from({ length: 5 }, (_, index) => `- [Post ${index}](./post-${index}.md)\n`),
    '<!-- INDEX:END -->',
  ].join('\n'))]);
  const found = new Set<string>();
  for (let page = 1; page <= 3; page++) {
    const response = await handleSiteRequest(store, '/blog/', {
      draftMode: 'exclude', siteConfig: config, searchParams: new URLSearchParams({ page: String(page) }),
    });
    assert.equal(response.status, 200);
    const html = String(response.body);
    const canonical = `https://example.com/blog/${page === 1 ? '' : `?page=${page}`}`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`));
    assert.ok(response.headers.link.includes(`<${canonical}>`));
    for (const match of html.matchAll(/class="catalog-item" href="([^"]+)"/g)) {
      assert.ok(!found.has(match[1]), `duplicate article ${match[1]}`);
      found.add(match[1]);
    }
    if (page < 3) assert.match(html, new RegExp(`rel="next" href="/blog/\\?page=${page + 1}"`));
    if (page > 1) assert.match(html, /rel="prev"/);
  }
  assert.equal(found.size, 5);
  for (const page of ['0', '-1', '2junk', '4', '99999999999999999']) {
    const response = await handleSiteRequest(store, '/blog/', {
      draftMode: 'exclude', siteConfig: config, searchParams: new URLSearchParams({ page }),
    });
    assert.equal(response.status, 404, page);
  }
  const fragment = await handleSiteRequest(store, '/blog/', {
    draftMode: 'exclude', siteConfig: config,
    searchParams: new URLSearchParams({ 'listing-format': 'posts', 'listing-offset': '2', 'listing-limit': '2' }),
  });
  assert.equal(fragment.headers['x-robots-tag'], 'noindex');
  assert.match(fragment.headers['content-type'], /application\/json/);
});

test('optional structured data shares normalized identity without inventing authors or dates', async () => {
  const store = new MemoryContentStore([
    entry('post.md', '---\ntype: post\ntitle: "Safe </script> title"\nauthor: [Alice, Bob]\ndate: 2026-01-01\nupdated: 2026-10-21\n---\n# Post'),
    entry('doc.md', '# Documentation'),
  ]);
  const read = async (href: string, enabled = true) => handleSiteRequest(store, href, {
    draftMode: 'exclude', siteConfig: { ...config, structuredData: enabled, showDate: false },
  });
  const post = String((await read('/post')).body);
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(post)![1];
  assert.doesNotMatch(script, /<\/script>/);
  const data = JSON.parse(script);
  assert.equal(data['@type'], 'BlogPosting');
  assert.equal(data.headline, 'Safe </script> title');
  assert.equal(data.datePublished, '2026-01-01');
  assert.equal(data.dateModified, '2026-10-21');
  assert.equal(data.author.length, 2);
  const doc = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(String((await read('/doc')).body))![1]);
  assert.equal(doc['@type'], 'WebPage');
  assert.equal(doc.author, undefined);
  assert.equal(doc.datePublished, undefined);
  assert.doesNotMatch(String((await read('/post', false)).body), /application\/ld\+json/);
});

test('stale, legacy, ambiguous, and noncanonical source matches never claim exact citations', async () => {
  const original = '# Heading\n\nOriginal paragraph.';
  const hit: SearchHit = {
    docId: '/guide/', relativePath: 'guide/README.md', canonicalUrl: 'https://example.com/guide/',
    metadata: { contentRevision: await getSearchContentRevision(original) }, score: 1,
    bestMatch: { chunkId: 1, excerpt: 'Original paragraph.', headingPath: ['Heading'],
      charStart: new TextEncoder().encode('# Heading\n\n').byteLength, charEnd: original.length, score: 1 },
  };
  assert.ok(await resolveSearchCitation(new MemoryContentStore([entry('guide/README.md', original)]), hit, 'exclude'));
  assert.equal(await resolveSearchCitation(new MemoryContentStore([entry('guide/README.md', '# Changed\n\nOriginal paragraph.')]), hit, 'exclude'), undefined);
  assert.equal(await resolveSearchCitation(new MemoryContentStore([entry('guide/README.md', original)]), { ...hit, metadata: {} }, 'exclude'), undefined);
  assert.equal(await resolveSearchCitation(new MemoryContentStore([
    entry('guide/index.md', '# Actual HTML'), entry('guide/README.md', original),
  ]), hit, 'exclude'), undefined);
  const duplicate = `${original}\n\n## Repeated\n\nOriginal paragraph.`;
  assert.equal(await resolveSearchCitation(new MemoryContentStore([entry('guide/README.md', duplicate)]), {
    ...hit, metadata: { contentRevision: await getSearchContentRevision(duplicate) },
  }, 'exclude'), undefined);
  const comment = '## Hello<!-- mdorigin:foo --> World\n\nUnique paragraph.';
  const transformed = '## Hello World\n\nUnique paragraph.';
  const commentHit = {
    ...hit, metadata: { contentRevision: await getSearchContentRevision(transformed) },
    bestMatch: { ...hit.bestMatch, excerpt: 'Unique paragraph.', charStart: transformed.indexOf('Unique') },
  };
  assert.equal(await resolveSearchCitation(new MemoryContentStore([entry('guide/README.md', comment)]), commentHit, 'exclude'), 'https://example.com/guide/#hello-world');
});

test('canonical directory entry controls noindex discovery even when alternate entry files exist', async () => {
  const store = new MemoryContentStore([
    entry('guide/index.md', '---\nnoindex: true\n---\n# Canonical hidden'),
    entry('guide/README.md', '# Alternate visible'),
  ]);
  for (const href of ['/sitemap.xml', '/llms.txt']) {
    const result = await handleSiteRequest(store, href, { draftMode: 'exclude', siteConfig: { ...config, llmsTxt: true } });
    assert.doesNotMatch(String(result.body), /guide\/|Alternate/);
  }
});

test('Cloudflare preserves discovery and indexing contracts through cached and negotiated responses', async () => {
  const worker = createCloudflareWorker({
    siteConfig: { ...config, llmsTxt: true }, deployVersion: 'seo-contract',
    entries: [entry('README.md', '# Home'), entry('hidden.md', '---\nnoindex: true\n---\n# Hidden')],
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const accept of ['text/html', 'text/markdown']) {
      const response = await worker.fetch(new Request('https://example.com/hidden', { headers: { accept } }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex');
      assert.match(response.headers.get('link')!, /<https:\/\/example.com\/hidden>; rel="canonical"/);
    }
  }
  for (const href of ['/sitemap.xml', '/llms.txt']) {
    const response = await worker.fetch(new Request(`https://example.com${href}`));
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /hidden/);
  }
});
