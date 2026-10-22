import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSearchBundle, createSearchApiFromDirectory } from './search.js';
import { createFileSystemContentStore } from './adapters/node.js';
import { loadSiteConfig } from './core/site-config.js';
import { handleSiteRequest } from './core/request-handler.js';
import { escapeHtml } from './html/template.js';

// Task-level relevance labels, not claims about public search rankings.
const tasks: Array<[query: string, expectedPath: string | null]> = [
  ['install mdorigin npm', 'guides/getting-started.md'],
  ['preview a site mdorigin dev --root', 'guides/getting-started.md'],
  ['build directory indexes', 'concepts/directory-indexes.md'],
  ['Accept text/markdown negotiation', 'concepts/routing.md'],
  ['README.md index.md SKILL.md canonical paths', 'concepts/routing.md'],
  ['aliases old URLs redirect', 'concepts/routing.md'],
  ['Cloudflare external binary R2 deployment', 'guides/cloudflare.md'],
  ['Wrangler configuration initialize', 'guides/cloudflare.md'],
  ['Cloudflare cache ETag immutable', 'guides/cloudflare.md'],
  ['transformIndex renderHeader renderFooter hooks', 'guides/extensions.md'],
  ['renderPage page context next', 'guides/extensions.md'],
  ['PageRenderModel extension data structures', 'guides/extensions.md'],
  ['siteUrl socialImage favicon', 'reference/configuration.md'],
  ['locales hreflang language configuration', 'reference/configuration.md'],
  ['search shortQuery longQuery minScore', 'reference/configuration.md'],
  ['安装 mdorigin npm', 'zh-CN/guides/getting-started.md'],
  ['本地预览 mdorigin dev', 'zh-CN/guides/getting-started.md'],
  ['目录索引生成', 'zh-CN/concepts/directory-indexes.md'],
  ['Accept text/markdown 内容协商', 'zh-CN/concepts/routing.md'],
  ['README.md SKILL.md 路由', 'zh-CN/concepts/routing.md'],
  ['aliases 旧链接重定向', 'zh-CN/concepts/routing.md'],
  ['Cloudflare R2 外部二进制资源部署', 'zh-CN/guides/cloudflare.md'],
  ['Wrangler 配置初始化', 'zh-CN/guides/cloudflare.md'],
  ['Cloudflare 缓存 ETag', 'zh-CN/guides/cloudflare.md'],
  ['transformIndex renderHeader 扩展钩子', 'zh-CN/guides/extensions.md'],
  ['renderPage 自定义页面渲染', 'zh-CN/guides/extensions.md'],
  ['PageRenderModel 页面模型', 'zh-CN/guides/extensions.md'],
  ['siteUrl socialImage 站点配置', 'zh-CN/reference/configuration.md'],
  ['locales 多语言配置', 'zh-CN/reference/configuration.md'],
  ['shortQuery longQuery 搜索策略', 'zh-CN/reference/configuration.md'],
  ['zxqv_nonexistent_identifier_948237', null],
  ['quantum submarine insurance policy', null],
  ['月球潜艇保险赔偿流程', null],
];

test('docs search evaluation records vector/hybrid task baselines and validates every emitted citation', async (t) => {
  try {
    await import('indexbind/web');
  } catch {
    t.skip('optional indexbind is not installed');
    return;
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/site');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'mdorigin-evaluation-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const siteConfig = await loadSiteConfig({ rootDir });
  const store = createFileSystemContentStore(rootDir);
  await buildSearchBundle({ rootDir, outDir, siteConfig, embeddingBackend: 'hashing' });

  for (const mode of ['vector', 'hybrid'] as const) {
    const searchApi = await createSearchApiFromDirectory(outDir, { mode });
    let recalled = 0, reciprocalRank = 0, empty = 0, citations = 0, responseBytes = 0;
    let negativeEmpty = 0;
    const misses: string[] = [];
    for (const [query, expectedPath] of tasks) {
      const response = await handleSiteRequest(store, '/api/search', {
        draftMode: 'exclude', siteConfig, searchApi,
        searchParams: new URLSearchParams({ q: query, topK: '5' }),
      });
      assert.equal(response.status, 200);
      responseBytes += new TextEncoder().encode(String(response.body)).byteLength;
      const payload = JSON.parse(String(response.body));
      const rank = payload.hits.findIndex((hit: { relativePath: string }) => hit.relativePath === expectedPath);
      if (payload.hits.length === 0) empty++;
      if (expectedPath === null && payload.hits.length === 0) negativeEmpty++;
      if (expectedPath !== null) {
        if (rank >= 0) { recalled++; reciprocalRank += 1 / (rank + 1); }
        else misses.push(query);
      }
      for (const hit of payload.hits) {
        if (!hit.citationUrl) continue;
        citations++;
        const url = new URL(hit.citationUrl, 'https://example.com');
        const page = await handleSiteRequest(store, url.pathname, {
          draftMode: 'exclude', siteConfig, userAgentHeader: 'EvaluationBot',
        });
        assert.equal(page.status, 200, hit.citationUrl);
        const id = decodeURIComponent(url.hash.slice(1));
        assert.ok(String(page.body).includes(`id="${escapeHtml(id)}"`), hit.citationUrl);
      }
    }
    assert.ok(citations > 0, 'the actual built index must exercise citation rendering');
    t.diagnostic(JSON.stringify({
      backend: 'hashing', mode, tasks: tasks.length, positiveTasks: 30,
      recallAt5: recalled / 30, mrr: reciprocalRank / 30,
      emptyResultRate: empty / tasks.length, negativeEmptyRate: negativeEmpty / 3,
      citationCount: citations, citationLandingAccuracy: 1,
      meanSearchResponseBytes: Math.round(responseBytes / tasks.length), misses,
    }));
  }
});

test('site-search inclusion is independent of noindex and canonical directory sources are unique', async (t) => {
  try {
    await import('indexbind/web');
  } catch {
    t.skip('optional indexbind is not installed');
    return;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mdorigin-inclusion-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const rootDir = path.join(tempDir, 'site');
  const outDir = path.join(tempDir, 'index');
  await mkdir(path.join(rootDir, 'bundle'), { recursive: true });
  for (const [relativePath, text] of [
    ['visible.md', '# Visible\n\nCommon marker visible.'],
    ['noindex.md', '---\nnoindex: true\nupdated: 2026-10-22\nauthor: Alice\n---\n# Noindex\n\nCommon marker searchable.'],
    ['excluded.md', '---\nsearch: false\n---\n# Excluded\n\nCommon marker excluded.'],
    ['draft.md', '---\ndraft: true\n---\n# Draft\n\nCommon marker unpublished.'],
    ['bundle/index.md', '# Canonical\n\nCommon marker canonical.'],
    ['bundle/README.md', '# Alternate\n\nCommon marker alternate.'],
  ]) await writeFile(path.join(rootDir, relativePath), text);
  const siteConfig = await loadSiteConfig({ rootDir });
  const result = await buildSearchBundle({ rootDir, outDir, siteConfig, embeddingBackend: 'hashing' });
  assert.equal(result.documentCount, 3);
  const api = await createSearchApiFromDirectory(outDir);
  const hits = await api.search('common marker', { topK: 10 });
  const paths = new Set(hits.map((hit) => hit.relativePath));
  assert.ok(paths.has('noindex.md'));
  assert.equal(hits.find((hit) => hit.relativePath === 'noindex.md')?.metadata.updated, '2026-10-22');
  assert.equal(hits.find((hit) => hit.relativePath === 'noindex.md')?.metadata.author, 'Alice');
  assert.ok(paths.has('bundle/index.md'));
  assert.ok(!paths.has('bundle/README.md'));
  assert.ok(!paths.has('excluded.md'));
  assert.ok(!paths.has('draft.md'));
});
