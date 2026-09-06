import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MemoryContentStore } from './content-store.js';
import {
  applySiteConfigFrontmatterDefaults,
  loadSiteConfig,
  loadUserSiteConfig,
} from './site-config.js';

test('loadSiteConfig prefers content root config over cwd config', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-cwd-'));
  const rootDir = path.join(cwd, 'docs', 'site');
  await mkdir(rootDir, { recursive: true });
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };

  try {
    await writeFile(
      path.join(cwd, 'mdorigin.config.json'),
      JSON.stringify({ siteTitle: 'cwd-title', theme: 'paper' }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(rootDir, 'mdorigin.config.json'),
      JSON.stringify(
        {
          siteTitle: 'root-title',
          theme: 'gazette',
          siteUrl: 'https://example.com',
          favicon: 'favicon.svg',
          logo: { src: 'logo.svg', alt: 'Example Logo' },
          footerNav: [{ label: 'GitHub', href: 'https://github.com/example/repo' }],
          footerText: 'Footer note',
          socialLinks: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/example/repo' }],
          editLink: { baseUrl: 'https://github.com/example/repo/edit/main/docs/' },
          catalogInitialPostCount: 6,
          catalogLoadMoreStep: 4,
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = await loadSiteConfig({ cwd, rootDir });

    assert.equal(config.siteTitle, 'root-title');
    assert.equal(config.siteUrl, 'https://example.com');
    assert.equal(config.favicon, '/favicon.svg');
    assert.deepEqual(config.logo, { src: '/logo.svg', alt: 'Example Logo', href: undefined });
    assert.equal(config.footerNav[0]?.label, 'GitHub');
    assert.equal(config.footerText, 'Footer note');
    assert.equal(config.socialLinks[0]?.icon, 'github');
    assert.deepEqual(config.editLink, {
      baseUrl: 'https://github.com/example/repo/edit/main/docs/',
    });
    assert.equal(config.listingInitialPostCount, 6);
    assert.equal(config.listingLoadMoreStep, 4);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0] ?? '', /"theme" is deprecated/);
    assert.match(warnings[1] ?? '', /"catalogInitialPostCount" is deprecated/);
    assert.match(warnings[2] ?? '', /"catalogLoadMoreStep" is deprecated/);
  } finally {
    console.warn = originalWarn;
  }
});

test('applySiteConfigFrontmatterDefaults uses root homepage frontmatter when config is absent', async () => {
  const config = await loadSiteConfig({
    cwd: await mkdtemp(path.join(tmpdir(), 'mdorigin-config-fallback-')),
  });
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Example Site',
        'summary: Example description',
        '---',
        '',
        '# Example Site',
      ].join('\n'),
    },
  ]);

  const resolved = await applySiteConfigFrontmatterDefaults(store, config);

  assert.equal(resolved.siteTitle, 'Example Site');
  assert.equal(resolved.siteDescription, 'Example description');
});

test('applySiteConfigFrontmatterDefaults does not override explicit config values', async () => {
  const store = new MemoryContentStore([
    {
      path: 'README.md',
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
      text: [
        '---',
        'title: Example Site',
        'summary: Example description',
        '---',
        '',
        '# Example Site',
      ].join('\n'),
    },
  ]);

  const resolved = await applySiteConfigFrontmatterDefaults(store, {
    siteTitle: 'Configured Title',
    siteDescription: 'Configured Description',
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
    siteDescriptionConfigured: true,
  });

  assert.equal(resolved.siteTitle, 'Configured Title');
  assert.equal(resolved.siteDescription, 'Configured Description');
});

test('loadSiteConfig auto-enables rss when siteUrl is present and normalizes overrides', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-rss-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify(
      {
        siteUrl: 'https://example.com',
        rss: {
          title: 'Example Feed',
          description: 'Latest posts',
          author: 'editor@example.com',
          maxItems: '12',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = await loadSiteConfig({ rootDir });

  assert.equal(config.siteUrl, 'https://example.com');
  assert.deepEqual(config.rss, {
    enabled: true,
    title: 'Example Feed',
    description: 'Latest posts',
    author: 'editor@example.com',
    maxItems: 12,
  });
});

test('loadSiteConfig allows rss to be disabled explicitly', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-rss-disabled-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify(
      {
        siteUrl: 'https://example.com',
        rss: false,
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = await loadSiteConfig({ rootDir });

  assert.deepEqual(config.rss, {
    enabled: false,
    title: undefined,
    description: undefined,
    author: undefined,
    maxItems: 20,
  });
});

test('loadUserSiteConfig prefers mdorigin.config.ts and exposes plugins', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-ts-'));
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  await writeFile(
    path.join(rootDir, 'mdorigin.config.ts'),
    [
      'export default {',
      '  siteTitle: "TS Config",',
      '  listingInitialPostCount: 8,',
      '  plugins: [',
      '    {',
      '      name: "example",',
      '      transformHtml(html) {',
      '        return html.replace("</body>", "<!-- plugin --></body>");',
      '      },',
      '    },',
      '  ],',
      '};',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify({ siteTitle: 'JSON Config', theme: 'paper' }, null, 2),
    'utf8',
  );

  try {
    const loaded = await loadUserSiteConfig({ rootDir });

    assert.equal(loaded.siteConfig.siteTitle, 'TS Config');
    assert.equal(loaded.siteConfig.listingInitialPostCount, 8);
    assert.equal(loaded.plugins.length, 1);
    assert.match(loaded.configModulePath ?? '', /mdorigin\.config\.ts$/);
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test('loadSiteConfig normalizes search profile settings', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-search-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify(
      {
        search: {
          topK: '12',
          mode: 'hybrid',
          minScore: '0.05',
          reranker: {
            kind: 'embedding-v1',
            candidatePoolSize: '24',
          },
          scoreAdjustment: {
            metadataNumericMultiplier: 'directory_weight',
          },
          policy: {
            shortQuery: {
              maxChars: '6',
              minScore: '0.02',
              reranker: null,
            },
            longQuery: {
              minChars: '12',
              reranker: {
                kind: 'heuristic-v1',
                candidatePoolSize: '20',
              },
              scoreAdjustment: null,
            },
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = await loadSiteConfig({ rootDir });

  assert.deepEqual(config.search, {
    topK: 12,
    mode: 'hybrid',
    minScore: 0.05,
    reranker: {
      kind: 'embedding-v1',
      candidatePoolSize: 24,
    },
    scoreAdjustment: {
      metadataNumericMultiplier: 'directory_weight',
    },
    policy: {
      shortQuery: {
        maxChars: 6,
        minScore: 0.02,
        reranker: null,
      },
      longQuery: {
        minChars: 12,
        reranker: {
          kind: 'heuristic-v1',
          candidatePoolSize: 20,
        },
        scoreAdjustment: null,
      },
    },
  });
});

test('loadSiteConfig defaults locale to en and resolves message overrides', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-locale-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify(
      {
        siteTitle: 'Locale Site',
        messages: {
          'search.toggle': 'Zoeken',
          'listing.emptyDirectory': 'Deze map is leeg.',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = await loadSiteConfig({ rootDir });

  assert.equal(config.locale, 'en');
  assert.deepEqual(config.messages, {
    'search.toggle': 'Zoeken',
    'listing.emptyDirectory': 'Deze map is leeg.',
  });
});

test('loadSiteConfig keeps an explicitly configured locale', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-locale-zh-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify({ siteTitle: 'Locale Site', locale: 'zh-CN' }, null, 2),
    'utf8',
  );

  const config = await loadSiteConfig({ rootDir });

  assert.equal(config.locale, 'zh-CN');
  assert.deepEqual(config.messages, {});
});

test('loadSiteConfig rejects unknown message keys', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-messages-invalid-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify({ messages: { 'search.togle': 'typo' } }, null, 2),
    'utf8',
  );

  await assert.rejects(
    loadSiteConfig({ rootDir }),
    /"messages" contains unknown keys: search\.togle/,
  );
});
test('loadSiteConfig rejects removed search.hybrid setting', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-search-legacy-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify(
      {
        search: {
          hybrid: true,
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await assert.rejects(
    () => loadSiteConfig({ rootDir }),
    /"search\.hybrid" has been removed/,
  );
});

test('loadSiteConfig resolves locales with default prefixes and content bases', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-locales-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify(
      {
        siteTitle: 'Multi Site',
        locales: [
          { code: 'en', default: true },
          { code: 'zh-CN', label: '中文', messages: { 'search.go': '找' } },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = await loadSiteConfig({ rootDir });

  assert.equal(config.locale, 'en');
  assert.deepEqual(config.locales, [
    {
      code: 'en',
      label: 'en',
      pathPrefix: '',
      isDefault: true,
      contentBase: '',
      messages: {},
      siteTitle: undefined,
      siteDescription: undefined,
      topNav: [],
      footerNav: [],
    },
    {
      code: 'zh-CN',
      label: '中文',
      pathPrefix: '/zh-CN',
      isDefault: false,
      contentBase: 'zh-CN',
      messages: { 'search.go': '找' },
      siteTitle: undefined,
      siteDescription: undefined,
      topNav: [],
      footerNav: [],
    },
  ]);
});

test('loadSiteConfig resolves locale site identity and navigation overrides', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-locale-overrides-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify(
      {
        siteTitle: 'Base Site',
        siteDescription: 'Base description',
        topNav: [{ label: 'Global', href: '/global/' }],
        locales: [
          { code: 'en', default: true },
          {
            code: 'zh-CN',
            label: '中文',
            siteTitle: '  中文站  ',
            siteDescription: '中文描述',
            topNav: [{ label: '指南', href: '/zh-CN/guides/' }],
            footerNav: [{ label: '关于', href: '/zh-CN/about/' }],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = await loadSiteConfig({ rootDir });

  const zhLocale = config.locales?.find((locale) => locale.code === 'zh-CN');
  assert.equal(zhLocale?.siteTitle, '中文站');
  assert.equal(zhLocale?.siteDescription, '中文描述');
  assert.deepEqual(zhLocale?.topNav, [{ label: '指南', href: '/zh-CN/guides/' }]);
  assert.deepEqual(zhLocale?.footerNav, [{ label: '关于', href: '/zh-CN/about/' }]);

  const enLocale = config.locales?.find((locale) => locale.code === 'en');
  assert.equal(enLocale?.siteTitle, undefined);
  assert.equal(enLocale?.siteDescription, undefined);
  assert.deepEqual(enLocale?.topNav, []);
  assert.deepEqual(enLocale?.footerNav, []);
});

test('loadSiteConfig resolves an explicit default pathPrefix', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-locales-prefixed-'));
  await writeFile(
    path.join(rootDir, 'mdorigin.config.json'),
    JSON.stringify(
      {
        locales: [
          { code: 'en', default: true, pathPrefix: '/en' },
          { code: 'zh' },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const config = await loadSiteConfig({ rootDir });

  assert.equal(config.locales?.[0]?.pathPrefix, '/en');
  assert.equal(config.locales?.[0]?.contentBase, 'en');
  assert.equal(config.locales?.[1]?.pathPrefix, '/zh');
});

test('loadSiteConfig rejects invalid locales configurations', async () => {
  const cases: Array<{ config: unknown; pattern: RegExp }> = [
    {
      config: { locales: [{ code: 'en' }] },
      pattern: /exactly one locale with "default": true \(found 0\)/,
    },
    {
      config: { locales: [{ code: 'en', default: true }, { code: 'zh', default: true }] },
      pattern: /exactly one locale with "default": true \(found 2\)/,
    },
    {
      config: { locales: [{ code: 'en', default: true }, { code: 'EN' }] },
      pattern: /duplicate "locales" code: EN/,
    },
    {
      config: { locales: [{ code: 'en', default: true }, { code: 'zh-CN', pathPrefix: '/zh' }] },
      pattern: /"locales\[zh-CN\]\.pathPrefix" must be "\/zh-CN" or ""/,
    },
    {
      config: { locales: [{ code: 'en', default: true, pathPrefix: '' }, { code: 'zh', pathPrefix: '' }] },
      pattern: /"locales\[zh\]\.pathPrefix" can only be empty for the default locale/,
    },
    {
      config: { locale: 'fr', locales: [{ code: 'en', default: true }, { code: 'zh' }] },
      pattern: /"locale" \(fr\) conflicts with the default "locales" entry \(en\)/,
    },
    {
      config: { locales: [{ code: 'en', default: true }, { code: 'zh', messages: { 'nope.key': 'x' } }] },
      pattern: /"locales\[zh\]\.messages" contains unknown keys: nope\.key/,
    },
  ];

  for (const { config, pattern } of cases) {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-config-locales-invalid-'));
    await writeFile(
      path.join(rootDir, 'mdorigin.config.json'),
      JSON.stringify(config),
      'utf8',
    );
    await assert.rejects(loadSiteConfig({ rootDir }), pattern);
  }
});
