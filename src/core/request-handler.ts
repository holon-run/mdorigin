import path from 'node:path';

import type {
  ContentDirectoryEntry,
  ContentEntry,
  ContentStore,
} from './content-store.js';
import { isIgnoredContentName } from './content-store.js';
import {
  inferDirectoryContentType,
  resolveContentType,
} from './content-type.js';
import { getDirectoryIndexCandidates } from './directory-index.js';
import {
  extractManagedIndexEntries,
  getDocumentSummary,
  getDocumentTitle as getParsedDocumentTitle,
  type ParsedDocumentMeta,
  parseMarkdownDocument,
  stripManagedIndexBlock,
  stripManagedIndexLinks,
  stripMachineOnlyMarkdownComments,
} from './markdown.js';
import { ensureTrailingSlash, trimLeadingSlash } from './site-url.js';
import type {
  MdoPlugin,
  PageLanguage,
  PageRenderModel,
  RenderHookContext,
} from './extensions.js';
import {
  applyIndexTransforms,
  renderFooterOverride,
  renderHeaderOverride,
  renderPageWithPlugins,
  transformHtmlWithPlugins,
} from './extensions.js';
import type {
  ResolvedLocaleConfig,
  ResolvedSiteConfig,
  SiteNavItem,
} from './site-config.js';
import { handleApiRoute } from './api.js';
import { matchRequestLocale, normalizeRequestPath, resolveRequest } from './router.js';
import {
  escapeHtml,
  renderListingArticleItems,
  renderDocument,
} from '../html/template.js';
import {
  formatSiteMessage,
  resolveSiteMessages,
  type SiteMessages,
} from '../i18n/messages.js';
import type { SearchApi } from '../search.js';

export interface HandleSiteRequestOptions {
  draftMode: 'include' | 'exclude';
  siteConfig: ResolvedSiteConfig;
  acceptHeader?: string;
  searchParams?: URLSearchParams;
  requestUrl?: string;
  searchApi?: SearchApi;
  plugins?: MdoPlugin[];
}

export interface SiteResponse {
  status: number;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

export async function handleSiteRequest(
  store: ContentStore,
  pathname: string,
  options: HandleSiteRequestOptions,
): Promise<SiteResponse> {
  const plugins = options.plugins ?? [];
  const searchEnabled = options.searchApi !== undefined;
  const requestLocale = matchRequestLocale(pathname, options.siteConfig.locales);
  const defaultLocale = options.siteConfig.locales?.find((locale) => locale.isDefault);
  if (defaultLocale !== undefined && defaultLocale.pathPrefix !== '' && pathname === '/') {
    return redirect(`${defaultLocale.pathPrefix}/`);
  }
  const apiRoute = await handleApiRoute(pathname, options.searchParams, {
    searchApi: options.searchApi,
    siteConfig: options.siteConfig,
    requestUrl: options.requestUrl,
  });
  if (apiRoute !== null) {
    return apiRoute;
  }

  if (pathname === '/sitemap.xml') {
    return renderSitemap(store, options);
  }

  if (pathname === '/feed.xml') {
    return renderRssFeed(store, options, defaultLocale ?? null);
  }

  if (options.siteConfig.locales !== undefined && requestLocale !== null) {
    for (const locale of options.siteConfig.locales) {
      if (locale.pathPrefix !== '' && pathname === `${locale.pathPrefix}/feed.xml`) {
        return renderRssFeed(store, options, locale);
      }
    }
  }

  const resolved = resolveRequest(pathname);
  const listingFragmentRequest = getListingFragmentRequest(options.searchParams);
  const negotiatedMarkdown = shouldServeMarkdownForRequest(
    resolved,
    options.acceptHeader,
  );
  if (resolved.kind === 'not-found' || !resolved.sourcePath) {
    const aliasRedirect = await tryRedirectAlias(store, pathname, options);
    if (aliasRedirect !== null) {
      return aliasRedirect;
    }

    return renderNotFoundForRequest(store, pathname, options);
  }

  const entry = await store.get(resolved.sourcePath);
  if (entry === null) {
    const aliasRedirect = await tryRedirectAlias(store, pathname, options);
    if (aliasRedirect !== null) {
      return aliasRedirect;
    }

    const alternateDirectoryMarkdown = await tryServeAlternateDirectoryMarkdown(
      store,
      resolved,
      options,
      negotiatedMarkdown,
    );
    if (alternateDirectoryMarkdown !== null) {
      return alternateDirectoryMarkdown;
    }

    const alternateMarkdownRedirect = await tryRedirectAlternateDirectoryMarkdown(
      store,
      resolved,
      options,
    );
    if (alternateMarkdownRedirect !== null) {
      return alternateMarkdownRedirect;
    }

    const canonicalDirectoryRedirect = await tryRedirectCanonicalDirectoryPath(
      store,
      resolved,
    );
    if (canonicalDirectoryRedirect !== null) {
      return canonicalDirectoryRedirect;
    }

    if (resolved.kind === 'html' && resolved.requestPath.endsWith('/')) {
      const directoryIndexResponse = await tryRenderAlternateDirectoryIndex(
        store,
        resolved.requestPath,
        options,
      );
      if (directoryIndexResponse !== null) {
        return directoryIndexResponse;
      }

      return renderDirectoryListing(
        store,
        resolved.requestPath,
        options.siteConfig,
        searchEnabled,
        requestLocale,
      );
    }

    return renderNotFoundForResolvedRequest(store, resolved, options, negotiatedMarkdown, requestLocale);
  }

  if (resolved.kind === 'asset') {
    return serveAsset(entry);
  }

  if (entry.kind !== 'text' || entry.text === undefined) {
    return renderNotFoundForResolvedRequest(store, resolved, options, negotiatedMarkdown, requestLocale);
  }

  if (resolved.kind === 'markdown' || negotiatedMarkdown) {
    const parsed = await parseMarkdownDocument(resolved.sourcePath, entry.text);
    if (parsed.meta.draft === true && options.draftMode === 'exclude') {
      return renderNotFoundForResolvedRequest(store, resolved, options, negotiatedMarkdown, requestLocale);
    }

    return {
      status: 200,
      headers: withVaryAcceptIfNeeded(
        {
          'content-type': entry.mediaType,
        },
        negotiatedMarkdown,
      ),
      body: entry.text,
    };
  }

  const parsed = await parseMarkdownDocument(resolved.sourcePath, entry.text);
  if (parsed.meta.draft === true && options.draftMode === 'exclude') {
    return renderNotFoundForResolvedRequest(store, resolved, options, negotiatedMarkdown, requestLocale);
  }
  const navigation = await resolveTopNav(store, options.siteConfig, requestLocale);

  const renderedBody =
    isRootHomeRequest(resolved.requestPath) && !options.siteConfig.showHomeIndex
      ? stripManagedIndexBlock(entry.text)
      : isRootHomeRequest(resolved.requestPath) && navigation.items.length > 0
        ? stripManagedIndexLinks(
            entry.text,
            new Set(navigation.items.map((item) => item.href)),
          )
      : entry.text;
  const listingEntries = await applyIndexTransforms(
    extractManagedIndexEntries(renderedBody),
    plugins,
    {
      mode: 'render',
      requestPath: resolved.requestPath,
      sourcePath: resolved.sourcePath,
      siteConfig: options.siteConfig,
    },
  );
  if (listingFragmentRequest !== null && listingEntries.length > 0) {
    return renderListingPostsFragment(listingEntries, listingFragmentRequest);
  }
  const documentBody =
    listingEntries.length > 0 ? stripManagedIndexBlock(renderedBody) : renderedBody;
  const renderedParsed = documentBody === entry.text
    ? parsed
    : await parseMarkdownDocument(resolved.sourcePath, documentBody);

  return renderStructuredPage({
    requestPath: resolved.requestPath,
    sourcePath: resolved.sourcePath,
    parsed,
    renderedParsed,
    siteConfig: options.siteConfig,
    topNav: navigation.items,
    listingEntries,
    searchEnabled,
    plugins,
    store,
    requestLocale,
    draftMode: options.draftMode,
    varyOnAccept: shouldVaryOnAccept(resolved),
  });
}

interface ListingFragmentRequest {
  offset: number;
  limit: number;
}

function getListingFragmentRequest(
  searchParams: URLSearchParams | undefined,
): ListingFragmentRequest | null {
  const format = searchParams?.get('listing-format') ?? searchParams?.get('catalog-format');
  if (format !== 'posts') {
    return null;
  }

  const offset = normalizeNonNegativeInteger(
    searchParams?.get('listing-offset') ?? searchParams?.get('catalog-offset') ?? null,
  );
  const limit = normalizePositiveInteger(
    searchParams?.get('listing-limit') ?? searchParams?.get('catalog-limit') ?? null,
  );

  if (offset === null || limit === null) {
    return null;
  }

  return { offset, limit };
}

function normalizeNonNegativeInteger(value: string | null): number | null {
  if (value === null) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizePositiveInteger(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildPageRenderModel(options: {
  resolvedRequestPath: string;
  sourcePath: string;
  renderedBodyHtml: string;
  parsed: Awaited<ReturnType<typeof parseMarkdownDocument>>;
  siteConfig: ResolvedSiteConfig;
  /** Locale-effective site title; falls back to the global config value. */
  siteTitle?: string;
  /** Locale-effective site description; falls back to the global config value. */
  siteDescription?: string;
  /** Locale-effective footer navigation; falls back to the global config value. */
  footerNav?: SiteNavItem[];
  topNav: SiteNavItem[];
  locale: string;
  languages: PageLanguage[];
  listingEntries: ReturnType<typeof extractManagedIndexEntries>;
  searchEnabled: boolean;
}): PageRenderModel {
  return {
    kind: options.listingEntries.length > 0 ? 'listing' : 'page',
    requestPath: options.resolvedRequestPath,
    sourcePath: options.sourcePath,
    locale: options.locale,
    languages: options.languages,
    siteTitle: options.siteTitle ?? options.siteConfig.siteTitle,
    siteDescription: options.siteDescription ?? options.siteConfig.siteDescription,
    siteUrl: options.siteConfig.siteUrl,
    favicon: options.siteConfig.favicon,
    socialImage: options.siteConfig.socialImage,
    logo: options.siteConfig.logo,
    title: getDocumentTitle(options.parsed),
    meta: options.parsed.meta,
    bodyHtml: options.renderedBodyHtml,
    summary:
      options.siteConfig.showSummary === false
        ? undefined
        : getDocumentSummary(options.parsed.meta, options.parsed.body),
    date:
      options.siteConfig.showDate === false ? undefined : options.parsed.meta.date,
    showSummary: options.siteConfig.showSummary,
    showDate: options.siteConfig.showDate,
    topNav: options.topNav,
    footerNav: options.footerNav ?? options.siteConfig.footerNav,
    footerText: options.siteConfig.footerText,
    socialLinks: options.siteConfig.socialLinks,
    editLink: options.siteConfig.editLink,
    editLinkHref: getEditLinkHref(options.siteConfig, options.sourcePath),
    stylesheetContent: options.siteConfig.stylesheetContent,
    canonicalPath: getCanonicalHtmlPathForContentPath(options.sourcePath),
    alternateMarkdownPath: getMarkdownRequestPathForContentPath(options.sourcePath),
    listingEntries: options.listingEntries,
    listingRequestPath: options.resolvedRequestPath,
    listingInitialPostCount: options.siteConfig.listingInitialPostCount,
    listingLoadMoreStep: options.siteConfig.listingLoadMoreStep,
    searchEnabled: options.searchEnabled,
  };
}

async function renderStructuredPage(options: {
  requestPath: string;
  sourcePath: string;
  parsed: Awaited<ReturnType<typeof parseMarkdownDocument>>;
  renderedParsed: Awaited<ReturnType<typeof parseMarkdownDocument>>;
  siteConfig: ResolvedSiteConfig;
  topNav: SiteNavItem[];
  listingEntries: ReturnType<typeof extractManagedIndexEntries>;
  searchEnabled: boolean;
  plugins: MdoPlugin[];
  varyOnAccept?: boolean;
  store: ContentStore;
  requestLocale: ResolvedLocaleConfig | null;
  draftMode: 'include' | 'exclude';
}): Promise<SiteResponse> {
  const localeConfig = options.requestLocale;
  const localeCode = localeConfig?.code ?? options.siteConfig.locale;
  const messages = getEffectiveLocaleMessages(options.siteConfig, localeConfig);
  const htmlLang = getFrontmatterLocale(options.parsed.meta) ?? localeCode;
  const languages = await buildLanguageOptions(
    options.store,
    { sourcePath: options.sourcePath },
    localeConfig,
    options.siteConfig,
    options.draftMode,
  );
  const hreflangAlternates = buildHreflangAlternates(languages, options.siteConfig);
  const searchLocaleFilter = buildSearchLocaleFilter(options.siteConfig, localeConfig);
  const page = buildPageRenderModel({
    resolvedRequestPath: options.requestPath,
    sourcePath: options.sourcePath,
    locale: localeCode,
    languages,
    renderedBodyHtml: options.renderedParsed.html,
    parsed: options.parsed,
    siteConfig: options.siteConfig,
    siteTitle: getEffectiveSiteTitle(options.siteConfig, localeConfig),
    siteDescription: getEffectiveSiteDescription(options.siteConfig, localeConfig),
    footerNav: getEffectiveFooterNav(options.siteConfig, localeConfig),
    topNav: options.topNav,
    listingEntries: options.listingEntries,
    searchEnabled: options.searchEnabled,
  });
  const renderContext: RenderHookContext = {
    page,
    siteConfig: options.siteConfig,
  };
  const renderedPage = await renderPageWithPlugins(
    page,
    options.plugins,
    renderContext,
    async (currentPage) => {
      const currentContext: RenderHookContext = {
        page: currentPage,
        siteConfig: options.siteConfig,
      };
      const headerHtml = await renderHeaderOverride(options.plugins, currentContext);
      const footerHtml = await renderFooterOverride(options.plugins, currentContext);
      return renderDocument({
        siteTitle: currentPage.siteTitle,
        siteDescription: currentPage.siteDescription,
        locale: htmlLang,
        messages,
        siteUrl: currentPage.siteUrl,
        favicon: currentPage.favicon,
        socialImage: currentPage.socialImage,
        logo: currentPage.logo,
        title: currentPage.title,
        body: currentPage.bodyHtml,
        summary: currentPage.summary,
        date: currentPage.date,
        showSummary: currentPage.showSummary,
        showDate: currentPage.showDate,
        topNav: currentPage.topNav,
        footerNav: currentPage.footerNav,
        footerText: currentPage.footerText,
        socialLinks: currentPage.socialLinks,
        editLinkHref: currentPage.editLinkHref,
        stylesheetContent: currentPage.stylesheetContent,
        canonicalPath: currentPage.canonicalPath,
        alternateMarkdownPath: currentPage.alternateMarkdownPath,
        rssFeedUrl: getRssFeedUrl(currentPage.siteUrl, options.siteConfig, localeConfig),
        listingEntries: currentPage.listingEntries,
        listingRequestPath: currentPage.listingRequestPath,
        listingInitialPostCount: currentPage.listingInitialPostCount,
        listingLoadMoreStep: currentPage.listingLoadMoreStep,
        searchEnabled: currentPage.searchEnabled,
        languages: currentPage.languages,
        hreflangAlternates,
        searchLocaleFilter,
        headerHtml,
        footerHtml,
      });
    },
  );
  const finalHtml = await transformHtmlWithPlugins(
    renderedPage.html,
    options.plugins,
    {
      page: renderedPage.page,
      siteConfig: options.siteConfig,
    },
  );

  return {
    status: 200,
    headers: withVaryAcceptIfNeeded(
      {
        'content-type': 'text/html; charset=utf-8',
      },
      options.varyOnAccept ?? false,
    ),
    body: finalHtml,
  };
}

function renderListingPostsFragment(
  entries: readonly {
    kind: 'directory' | 'article';
    title: string;
    href: string;
    detail?: string;
  }[],
  request: ListingFragmentRequest,
): SiteResponse {
  const articles = entries.filter((entry) => entry.kind === 'article');
  const visibleArticles = articles.slice(request.offset, request.offset + request.limit);
  const nextOffset = request.offset + visibleArticles.length;

  return {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      itemsHtml: renderListingArticleItems(visibleArticles),
      hasMore: nextOffset < articles.length,
      nextOffset,
    }),
  };
}

function serveAsset(entry: ContentEntry): SiteResponse {
  if (entry.kind === 'text' && entry.text !== undefined) {
    return {
      status: 200,
      headers: {
        'content-type': entry.mediaType,
      },
      body: entry.text,
    };
  }

  if (entry.kind === 'binary' && entry.bytes !== undefined) {
    return {
      status: 200,
      headers: {
        'content-type': entry.mediaType,
      },
      body: entry.bytes,
    };
  }

  return notFound();
}

function notFound(): SiteResponse {
  return {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
    body: 'Not Found',
  };
}

async function renderNotFoundForRequest(
  store: ContentStore,
  pathname: string,
  options: HandleSiteRequestOptions,
): Promise<SiteResponse> {
  const resolved = resolveRequest(pathname);
  return renderNotFoundForResolvedRequest(
    store,
    resolved,
    options,
    false,
    matchRequestLocale(pathname, options.siteConfig.locales),
  );
}

async function renderNotFoundForResolvedRequest(
  store: ContentStore,
  resolved: ReturnType<typeof resolveRequest>,
  options: HandleSiteRequestOptions,
  negotiatedMarkdown: boolean,
  requestLocale: ResolvedLocaleConfig | null,
): Promise<SiteResponse> {
  const varyOnAccept = shouldVaryOnAccept(resolved);
  if (resolved.kind !== 'html' || negotiatedMarkdown) {
    return withNotFoundVary(varyOnAccept);
  }

  return renderHtmlNotFound(
    store,
    resolved.requestPath,
    options,
    varyOnAccept,
    requestLocale,
  );
}

async function renderHtmlNotFound(
  store: ContentStore,
  requestPath: string,
  options: HandleSiteRequestOptions,
  varyOnAccept: boolean,
  requestLocale: ResolvedLocaleConfig | null,
): Promise<SiteResponse> {
  const localeConfig = requestLocale;
  const navigation = await resolveTopNav(store, options.siteConfig, localeConfig);
  const locale = localeConfig?.code ?? options.siteConfig.locale;
  const messages = getEffectiveLocaleMessages(options.siteConfig, localeConfig);
  const languages = await buildLanguageOptions(
    store,
    {},
    localeConfig,
    options.siteConfig,
    options.draftMode,
  );
  const body = [
    `<h1>${escapeHtml(messages['error.notFoundTitle'])}</h1>`,
    `<p>${formatSiteMessage(messages['error.notFoundBody'], {
      path: escapeHtml(requestPath),
    })}</p>`,
  ].join('');

  return {
    status: 404,
    headers: withVaryAcceptIfNeeded(
      {
        'content-type': 'text/html; charset=utf-8',
      },
      varyOnAccept,
    ),
    body: renderDocument({
      siteTitle: getEffectiveSiteTitle(options.siteConfig, localeConfig),
      siteDescription: getEffectiveSiteDescription(options.siteConfig, localeConfig),
      siteUrl: options.siteConfig.siteUrl,
      favicon: options.siteConfig.favicon,
      socialImage: options.siteConfig.socialImage,
      logo: options.siteConfig.logo,
      title: messages['error.notFoundTitle'],
      body,
      locale,
      messages,
      languages,
      showSummary: false,
      showDate: false,
      topNav: navigation.items,
      footerNav: getEffectiveFooterNav(options.siteConfig, localeConfig),
      footerText: options.siteConfig.footerText,
      socialLinks: options.siteConfig.socialLinks,
      stylesheetContent: options.siteConfig.stylesheetContent,
      rssFeedUrl: getRssFeedUrl(options.siteConfig.siteUrl, options.siteConfig, localeConfig),
      searchEnabled: options.searchApi !== undefined,
    }),
  };
}

function withNotFoundVary(varyOnAccept: boolean): SiteResponse {
  if (!varyOnAccept) {
    return notFound();
  }

  return {
    ...notFound(),
    headers: withVaryAcceptIfNeeded(
      {
        'content-type': 'text/plain; charset=utf-8',
      },
      true,
    ),
  };
}

function redirect(location: string): SiteResponse {
  return {
    status: 308,
    headers: {
      location,
    },
  };
}

function getEffectiveLocaleMessages(
  siteConfig: ResolvedSiteConfig,
  localeConfig: ResolvedLocaleConfig | null,
): SiteMessages {
  if (localeConfig === null) {
    return resolveSiteMessages(siteConfig.locale, siteConfig.messages);
  }

  return resolveSiteMessages(localeConfig.code, {
    ...siteConfig.messages,
    ...localeConfig.messages,
  });
}

function getEffectiveSiteTitle(
  siteConfig: ResolvedSiteConfig,
  localeConfig: ResolvedLocaleConfig | null,
): string {
  return localeConfig?.siteTitle ?? siteConfig.siteTitle;
}

function getEffectiveSiteDescription(
  siteConfig: ResolvedSiteConfig,
  localeConfig: ResolvedLocaleConfig | null,
): string | undefined {
  return localeConfig?.siteDescription ?? siteConfig.siteDescription;
}

function getEffectiveFooterNav(
  siteConfig: ResolvedSiteConfig,
  localeConfig: ResolvedLocaleConfig | null,
): SiteNavItem[] {
  if (localeConfig !== null && (localeConfig.footerNav?.length ?? 0) > 0) {
    return localeConfig.footerNav;
  }

  return siteConfig.footerNav;
}

function getFrontmatterLocale(meta: ParsedDocumentMeta): string | null {
  if (typeof meta.lang !== 'string') {
    return null;
  }

  const trimmed = meta.lang.trim();
  return trimmed === '' ? null : trimmed;
}

interface LanguageContentTarget {
  sourcePath?: string;
  directoryPath?: string;
}

async function buildLanguageOptions(
  store: ContentStore,
  target: LanguageContentTarget,
  currentLocale: ResolvedLocaleConfig | null,
  siteConfig: ResolvedSiteConfig,
  draftMode: 'include' | 'exclude',
): Promise<PageLanguage[]> {
  const locales = siteConfig.locales;
  if (locales === undefined || locales.length === 0) {
    return [];
  }

  const languages: PageLanguage[] = [];
  for (const locale of locales) {
    const translated = await localeHasContent(
      store,
      target,
      currentLocale,
      locale,
      draftMode,
    );
    languages.push({
      code: locale.code,
      label: locale.label,
      href:
        translated === null
          ? getLocaleHomePath(locale)
          : getCanonicalHtmlPathForContentPath(translated),
      current: locale === currentLocale,
      translated: translated !== null,
    });
  }

  return languages;
}

async function localeHasContent(
  store: ContentStore,
  target: LanguageContentTarget,
  currentLocale: ResolvedLocaleConfig | null,
  locale: ResolvedLocaleConfig,
  draftMode: 'include' | 'exclude',
): Promise<string | null> {
  if (locale === currentLocale) {
    return target.sourcePath
      ? target.sourcePath
      : target.directoryPath === ''
        ? 'index.md'
        : `${target.directoryPath}/index.md`;
  }

  const candidates: string[] = [];
  if (target.sourcePath !== undefined) {
    candidates.push(mapContentPathForLocale(target.sourcePath, currentLocale, locale));
  } else {
    const directoryPath = target.directoryPath ?? '';
    for (const candidate of getDirectoryIndexCandidates(
      mapContentPathForLocale(directoryPath, currentLocale, locale),
    )) {
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    if (await hasPublishedContent(store, candidate, draftMode)) {
      return candidate;
    }
  }

  return null;
}

function mapContentPathForLocale(
  contentPath: string,
  from: ResolvedLocaleConfig | null,
  to: ResolvedLocaleConfig,
): string {
  if (from === null || from.contentBase === '') {
    return to.contentBase === '' ? contentPath : `${to.contentBase}/${contentPath}`;
  }

  if (!contentPath.startsWith(`${from.contentBase}/`)) {
    return contentPath;
  }

  const rest = contentPath.slice(from.contentBase.length + 1);
  return to.contentBase === '' ? rest : `${to.contentBase}/${rest}`;
}

function getLocaleHomePath(locale: ResolvedLocaleConfig): string {
  return locale.pathPrefix === '' ? '/' : `${locale.pathPrefix}/`;
}

async function hasPublishedContent(
  store: ContentStore,
  contentPath: string,
  draftMode: 'include' | 'exclude',
): Promise<boolean> {
  const entry = await store.get(contentPath);
  if (entry === null || entry.kind !== 'text' || entry.text === undefined) {
    return false;
  }

  if (draftMode === 'exclude') {
    const parsed = await parseMarkdownDocument(contentPath, entry.text);
    if (parsed.meta.draft === true) {
      return false;
    }
  }

  return true;
}

function buildHreflangAlternates(
  languages: PageLanguage[],
  siteConfig: ResolvedSiteConfig,
): Array<{ hreflang: string; href: string }> {
  if (languages.length === 0 || siteConfig.siteUrl === undefined) {
    return [];
  }

  const base = ensureTrailingSlash(siteConfig.siteUrl);
  const alternates = languages
    .filter((language) => language.translated)
    .map((language) => ({
      hreflang: language.code,
      href: new URL(trimLeadingSlash(language.href), base).toString(),
    }));

  const defaultLocale = siteConfig.locales?.find((locale) => locale.isDefault);
  const defaultLanguage = defaultLocale
    ? languages.find((language) => language.code === defaultLocale.code)
    : undefined;
  if (defaultLanguage?.translated) {
    alternates.push({
      hreflang: 'x-default',
      href: new URL(trimLeadingSlash(defaultLanguage.href), base).toString(),
    });
  }

  return alternates;
}

function buildSearchLocaleFilter(
  siteConfig: ResolvedSiteConfig,
  localeConfig: ResolvedLocaleConfig | null,
): { include: string; exclude: string[] } | undefined {
  if (siteConfig.locales === undefined || localeConfig === null) {
    return undefined;
  }

  return {
    include: localeConfig.contentBase === '' ? '' : `${localeConfig.contentBase}/`,
    exclude: siteConfig.locales
      .filter((locale) => locale !== localeConfig && locale.contentBase !== '')
      .map((locale) => `${locale.contentBase}/`),
  };
}

async function renderSitemap(
  store: ContentStore,
  options: HandleSiteRequestOptions,
): Promise<SiteResponse> {
  if (!options.siteConfig.siteUrl) {
    return {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
      body: 'sitemap.xml requires siteUrl in mdorigin.config.json',
    };
  }

  const entries = await collectSitemapEntries(store, '', options);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => {
      const lastmod = entry.lastmod ? `<lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : '';
      return `  <url><loc>${escapeHtml(`${options.siteConfig.siteUrl}${entry.path}`)}</loc>${lastmod}</url>`;
    }),
    '</urlset>',
  ].join('\n');

  return {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
    },
    body,
  };
}

interface FeedItem {
  title: string;
  canonicalPath: string;
  absoluteUrl: string;
  summary?: string;
  pubDate: Date;
}

async function renderRssFeed(
  store: ContentStore,
  options: HandleSiteRequestOptions,
  locale: ResolvedLocaleConfig | null,
): Promise<SiteResponse> {
  if (!isRssEnabled(options.siteConfig) || !options.siteConfig.siteUrl) {
    return notFound();
  }

  const excludedLocaleDirectories = new Set(
    (options.siteConfig.locales ?? [])
      .filter((entry) => entry.contentBase !== '' && entry !== locale)
      .map((entry) => entry.contentBase),
  );
  const items = await collectRssFeedItems(
    store,
    locale?.contentBase ?? '',
    options,
    excludedLocaleDirectories,
  );
  const limitedItems = items.slice(0, options.siteConfig.rss?.maxItems ?? 20);
  const rssFeedUrl = getRssFeedUrl(options.siteConfig.siteUrl, options.siteConfig, locale);
  const title =
    options.siteConfig.rss?.title ?? getEffectiveSiteTitle(options.siteConfig, locale);
  const description =
    options.siteConfig.rss?.description ??
    getEffectiveSiteDescription(options.siteConfig, locale);
  const lastBuildDate = limitedItems[0]?.pubDate.toUTCString();
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `  <title>${escapeHtml(title)}</title>`,
    `  <link>${escapeHtml(options.siteConfig.siteUrl)}</link>`,
    description
      ? `  <description>${escapeHtml(description)}</description>`
      : '  <description></description>',
    '  <generator>mdorigin</generator>',
    rssFeedUrl
      ? `  <atom:link href="${escapeHtml(rssFeedUrl)}" rel="self" type="application/rss+xml" />`
      : '',
    options.siteConfig.rss?.author
      ? `  <managingEditor>${escapeHtml(options.siteConfig.rss.author)}</managingEditor>`
      : '',
    lastBuildDate ? `  <lastBuildDate>${escapeHtml(lastBuildDate)}</lastBuildDate>` : '',
    ...limitedItems.map((item) =>
      [
        '  <item>',
        `    <title>${escapeHtml(item.title)}</title>`,
        `    <link>${escapeHtml(item.absoluteUrl)}</link>`,
        `    <guid isPermaLink="true">${escapeHtml(item.absoluteUrl)}</guid>`,
        `    <pubDate>${escapeHtml(item.pubDate.toUTCString())}</pubDate>`,
        item.summary
          ? `    <description>${escapeHtml(item.summary)}</description>`
          : '',
        '  </item>',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    ),
    '</channel>',
    '</rss>',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return {
    status: 200,
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
    },
    body,
  };
}

function withVaryAcceptIfNeeded(
  headers: Record<string, string>,
  enabled: boolean,
): Record<string, string> {
  if (!enabled) {
    return headers;
  }

  return {
    ...headers,
    vary: appendVary(headers.vary, 'Accept'),
  };
}

function appendVary(existing: string | undefined, value: string): string {
  if (!existing || existing.trim() === '') {
    return value;
  }

  const parts = existing.split(',').map((part) => part.trim().toLowerCase());
  if (parts.includes(value.toLowerCase())) {
    return existing;
  }

  return `${existing}, ${value}`;
}

function getDocumentTitle(parsed: Awaited<ReturnType<typeof parseMarkdownDocument>>): string {
  const basename = path.posix.basename(parsed.sourcePath, '.md');
  const fallback =
    basename === 'index' || basename === 'README' || basename === 'SKILL'
      ? path.posix.basename(path.posix.dirname(parsed.sourcePath)) || 'mdorigin'
      : basename;
  return getParsedDocumentTitle(parsed.meta, parsed.body, fallback);
}

interface SitemapEntry {
  path: string;
  lastmod?: string;
}

async function collectSitemapEntries(
  store: ContentStore,
  directoryPath: string,
  options: HandleSiteRequestOptions,
): Promise<SitemapEntry[]> {
  const entries = await store.listDirectory(directoryPath);
  if (entries === null) {
    return [];
  }

  const sitemapEntries: SitemapEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === 'directory') {
      sitemapEntries.push(
        ...(await collectSitemapEntries(store, entry.path, options)),
      );
      continue;
    }

    if (!isMarkdownEntry(entry)) {
      continue;
    }

    const document = await store.get(entry.path);
    if (document === null || document.kind !== 'text' || document.text === undefined) {
      continue;
    }

    const parsed = await parseMarkdownDocument(entry.path, document.text);
    if (parsed.meta.draft === true && options.draftMode === 'exclude') {
      continue;
    }

    sitemapEntries.push({
      path: getCanonicalHtmlPathForContentPath(entry.path),
      lastmod: parsed.meta.date,
    });
  }

  sitemapEntries.sort((left, right) => left.path.localeCompare(right.path));
  return dedupeSitemapEntries(sitemapEntries);
}

function dedupeSitemapEntries(entries: SitemapEntry[]): SitemapEntry[] {
  const deduped = new Map<string, SitemapEntry>();
  for (const entry of entries) {
    const existing = deduped.get(entry.path);
    if (!existing) {
      deduped.set(entry.path, entry);
      continue;
    }

    if (!existing.lastmod && entry.lastmod) {
      deduped.set(entry.path, entry);
    }
  }

  return Array.from(deduped.values());
}

async function collectRssFeedItems(
  store: ContentStore,
  directoryPath: string,
  options: HandleSiteRequestOptions,
  excludedDirectories: Set<string>,
): Promise<FeedItem[]> {
  const entries = await store.listDirectory(directoryPath);
  if (entries === null) {
    return [];
  }

  const feedItems: FeedItem[] = [];
  const directoryShape = inspectDirectoryShapeEntries(entries);

  for (const entry of entries) {
    if (entry.kind === 'directory') {
      if (excludedDirectories.has(entry.path)) {
        continue;
      }
      feedItems.push(
        ...(await collectRssFeedItems(store, entry.path, options, excludedDirectories)),
      );
      continue;
    }

    if (!isMarkdownEntry(entry)) {
      continue;
    }

    const document = await store.get(entry.path);
    if (document === null || document.kind !== 'text' || document.text === undefined) {
      continue;
    }

    const parsed = await parseMarkdownDocument(entry.path, document.text);
    if (parsed.meta.draft === true && options.draftMode === 'exclude') {
      continue;
    }

    const pubDate = parseFeedDate(parsed.meta.date);
    if (pubDate === null) {
      continue;
    }

    const contentType = inferFeedContentType(entry.path, parsed.meta, directoryShape);
    if (contentType !== 'post') {
      continue;
    }

    const canonicalPath = getCanonicalHtmlPathForContentPath(entry.path);
    feedItems.push({
      title: getDocumentTitle(parsed),
      canonicalPath,
      absoluteUrl: new URL(
        trimLeadingSlash(canonicalPath),
        ensureTrailingSlash(options.siteConfig.siteUrl ?? ''),
      ).toString(),
      summary: getFeedSummary(parsed),
      pubDate,
    });
  }

  feedItems.sort((left, right) => {
    const timeDelta = right.pubDate.getTime() - left.pubDate.getTime();
    return timeDelta !== 0
      ? timeDelta
      : left.canonicalPath.localeCompare(right.canonicalPath);
  });
  return feedItems;
}

function inferFeedContentType(
  contentPath: string,
  meta: Awaited<ReturnType<typeof parseMarkdownDocument>>['meta'],
  directoryShape: Awaited<ReturnType<typeof inspectDirectoryShape>>,
): 'page' | 'post' {
  const explicitType = resolveContentType(meta);
  if (explicitType) {
    return explicitType;
  }

  if (isDirectoryIndexContentPath(contentPath)) {
    return inferDirectoryContentType(meta, directoryShape);
  }

  return typeof meta.date === 'string' && meta.date !== '' ? 'post' : 'page';
}

function getFeedSummary(
  parsed: Awaited<ReturnType<typeof parseMarkdownDocument>>,
): string | undefined {
  return getDocumentSummary(
    parsed.meta,
    stripMachineOnlyMarkdownComments(stripManagedIndexBlock(parsed.body)),
  );
}

function parseFeedDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function renderDirectoryListing(
  store: ContentStore,
  requestPath: string,
  siteConfig: ResolvedSiteConfig,
  searchEnabled: boolean,
  requestLocale: ResolvedLocaleConfig | null,
): Promise<SiteResponse> {
  const directoryPath =
    requestPath === '/' ? '' : requestPath.slice(1).replace(/\/$/, '');
  const entries = await store.listDirectory(directoryPath);
  if (entries === null) {
    return notFound();
  }

  const visibleEntries = entries.filter(isVisibleDirectoryEntry);
  const locale = requestLocale?.code ?? siteConfig.locale;
  const navigation = await resolveTopNav(store, siteConfig, requestLocale);
  const messages = getEffectiveLocaleMessages(siteConfig, requestLocale);
  const languages = await buildLanguageOptions(
    store,
    { directoryPath },
    requestLocale,
    siteConfig,
    'exclude',
  );
  const listItems = visibleEntries
    .map((entry) => `<li><a href="${getDirectoryEntryHref(requestPath, entry)}">${escapeHtml(getDirectoryEntryLabel(entry))}</a></li>`)
    .join('');

  const body = [
    `<h1>${escapeHtml(getDirectoryTitle(requestPath))}</h1>`,
    visibleEntries.length > 0
      ? `<ul>${listItems}</ul>`
      : `<p>${escapeHtml(messages['listing.emptyDirectory'])}</p>`,
  ].join('');

  return {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
    body: renderDocument({
      siteTitle: getEffectiveSiteTitle(siteConfig, requestLocale),
      siteDescription: getEffectiveSiteDescription(siteConfig, requestLocale),
      locale,
      messages,
      languages,
      siteUrl: siteConfig.siteUrl,
      favicon: siteConfig.favicon,
      logo: siteConfig.logo,
      title: getDirectoryTitle(requestPath),
      body,
      showSummary: false,
      showDate: false,
      topNav: navigation.items,
      footerNav: getEffectiveFooterNav(siteConfig, requestLocale),
      footerText: siteConfig.footerText,
      socialLinks: siteConfig.socialLinks,
      stylesheetContent: siteConfig.stylesheetContent,
      canonicalPath: requestPath,
      alternateMarkdownPath: getMarkdownRequestPathForContentPath(
        getDirectoryIndexContentPathForRequestPath(requestPath),
      ),
      rssFeedUrl: getRssFeedUrl(siteConfig.siteUrl, siteConfig, requestLocale),
      searchEnabled,
    }),
  };
}

function isVisibleDirectoryEntry(entry: ContentDirectoryEntry): boolean {
  if (entry.kind === 'directory') {
    return true;
  }

  return path.posix.extname(entry.name).toLowerCase() === '.md';
}

function getDirectoryEntryHref(
  requestPath: string,
  entry: ContentDirectoryEntry,
): string {
  const basePath = requestPath.endsWith('/') ? requestPath : `${requestPath}/`;
  if (entry.kind === 'directory') {
    return `${basePath}${entry.name}/`;
  }

  return `${basePath}${entry.name.slice(0, -'.md'.length)}`;
}

function getDirectoryEntryLabel(entry: ContentDirectoryEntry): string {
  return entry.kind === 'directory'
    ? `${entry.name}/`
    : entry.name.slice(0, -'.md'.length);
}

function getDirectoryTitle(requestPath: string): string {
  return requestPath === '/' ? 'Index' : requestPath;
}

function getDirectoryIndexContentPathForRequestPath(requestPath: string): string {
  return requestPath === '/'
    ? 'index.md'
    : `${requestPath.slice(1).replace(/\/$/, '')}/index.md`;
}

async function tryRenderAlternateDirectoryIndex(
  store: ContentStore,
  requestPath: string,
  options: HandleSiteRequestOptions,
): Promise<SiteResponse | null> {
  const plugins = options.plugins ?? [];
  const directoryPath =
    requestPath === '/' ? '' : requestPath.slice(1).replace(/\/$/, '');

  for (const candidatePath of getDirectoryIndexCandidates(directoryPath)) {
    if (candidatePath === (directoryPath === '' ? 'index.md' : `${directoryPath}/index.md`)) {
      continue;
    }

    const entry = await store.get(candidatePath);
    if (entry === null || entry.kind !== 'text' || entry.text === undefined) {
      continue;
    }

    const parsed = await parseMarkdownDocument(candidatePath, entry.text);
    if (parsed.meta.draft === true && options.draftMode === 'exclude') {
      return notFound();
    }
    const requestLocale = matchRequestLocale(requestPath, options.siteConfig.locales);
    const navigation = await resolveTopNav(store, options.siteConfig, requestLocale);
    const renderedBody =
      isRootHomeRequest(requestPath) && !options.siteConfig.showHomeIndex
        ? stripManagedIndexBlock(entry.text)
        : isRootHomeRequest(requestPath) && navigation.items.length > 0
          ? stripManagedIndexLinks(
              entry.text,
              new Set(navigation.items.map((item) => item.href)),
            )
        : entry.text;
    const listingEntries = await applyIndexTransforms(
      extractManagedIndexEntries(renderedBody),
      plugins,
      {
        mode: 'render',
        requestPath,
        sourcePath: candidatePath,
        siteConfig: options.siteConfig,
      },
    );
    const listingFragmentRequest = getListingFragmentRequest(options.searchParams);
    if (listingFragmentRequest !== null && listingEntries.length > 0) {
      return renderListingPostsFragment(listingEntries, listingFragmentRequest);
    }
    const documentBody =
      listingEntries.length > 0 ? stripManagedIndexBlock(renderedBody) : renderedBody;
    const renderedParsed = documentBody === entry.text
      ? parsed
      : await parseMarkdownDocument(candidatePath, documentBody);

    return renderStructuredPage({
      requestPath,
      sourcePath: candidatePath,
      parsed,
      renderedParsed,
      siteConfig: options.siteConfig,
      topNav: navigation.items,
      listingEntries,
      searchEnabled: options.searchApi !== undefined,
      plugins,
      store,
      requestLocale,
      draftMode: options.draftMode,
    });
  }

  return null;
}

async function tryServeAlternateDirectoryMarkdown(
  store: ContentStore,
  resolved: ReturnType<typeof resolveRequest>,
  options: HandleSiteRequestOptions,
  negotiatedMarkdown: boolean,
): Promise<SiteResponse | null> {
  if (!negotiatedMarkdown || resolved.kind !== 'html' || !resolved.sourcePath) {
    return null;
  }

  if (!resolved.requestPath.endsWith('/')) {
    return null;
  }

  const directoryPath = path.posix.dirname(resolved.sourcePath);
  for (const candidatePath of getDirectoryIndexCandidates(
    directoryPath === '.' ? '' : directoryPath,
  )) {
    if (candidatePath === resolved.sourcePath) {
      continue;
    }

    const entry = await store.get(candidatePath);
    if (entry === null || entry.kind !== 'text' || entry.text === undefined) {
      continue;
    }

    const parsed = await parseMarkdownDocument(candidatePath, entry.text);
    if (parsed.meta.draft === true && options.draftMode === 'exclude') {
      return notFound();
    }

    return {
      status: 200,
      headers: withVaryAcceptIfNeeded(
        {
          'content-type': entry.mediaType,
        },
        true,
      ),
      body: entry.text,
    };
  }

  return null;
}

async function tryRedirectAlternateDirectoryMarkdown(
  store: ContentStore,
  resolved: ReturnType<typeof resolveRequest>,
  options: HandleSiteRequestOptions,
): Promise<SiteResponse | null> {
  if (resolved.kind !== 'markdown' || !resolved.sourcePath) {
    return null;
  }

  const basename = path.posix.basename(resolved.sourcePath);
  if (basename !== 'index.md' && basename !== 'README.md') {
    return null;
  }

  const directoryPath = path.posix.dirname(resolved.sourcePath);
  for (const candidatePath of getDirectoryIndexCandidates(
    directoryPath === '.' ? '' : directoryPath,
  )) {
    if (candidatePath === resolved.sourcePath) {
      continue;
    }

    const entry = await store.get(candidatePath);
    if (entry === null || entry.kind !== 'text' || entry.text === undefined) {
      continue;
    }

    const parsed = await parseMarkdownDocument(candidatePath, entry.text);
    if (parsed.meta.draft === true && options.draftMode === 'exclude') {
      return null;
    }

    return redirect(getMarkdownRequestPathForContentPath(candidatePath));
  }

  return null;
}

async function tryRedirectCanonicalDirectoryPath(
  store: ContentStore,
  resolved: ReturnType<typeof resolveRequest>,
): Promise<SiteResponse | null> {
  if (resolved.kind !== 'html' || resolved.requestPath.endsWith('/')) {
    return null;
  }

  if (path.posix.extname(resolved.requestPath) !== '') {
    return null;
  }

  const directoryPath = resolved.requestPath.slice(1);
  if (directoryPath === '') {
    return null;
  }

  const directoryEntries = await store.listDirectory(directoryPath);
  if (directoryEntries === null) {
    return null;
  }

  return redirect(`${resolved.requestPath}/`);
}

function getMarkdownRequestPathForContentPath(contentPath: string): string {
  return `/${contentPath}`;
}

function isRootHomeRequest(requestPath: string): boolean {
  return requestPath === '/';
}

function shouldServeMarkdownForRequest(
  resolved: ReturnType<typeof resolveRequest>,
  acceptHeader: string | undefined,
): boolean {
  return shouldVaryOnAccept(resolved) && acceptsMarkdown(acceptHeader);
}

function shouldVaryOnAccept(
  resolved: ReturnType<typeof resolveRequest>,
): boolean {
  if (resolved.kind !== 'html') {
    return false;
  }

  return !resolved.requestPath.endsWith('.html');
}

function acceptsMarkdown(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) {
    return false;
  }

  return acceptHeader
    .split(',')
    .map((part) => part.split(';', 1)[0]?.trim().toLowerCase())
    .includes('text/markdown');
}

async function tryRedirectAlias(
  store: ContentStore,
  pathname: string,
  options: HandleSiteRequestOptions,
): Promise<SiteResponse | null> {
  const normalizedRequestPath = normalizeRequestPath(pathname);
  if (normalizedRequestPath === null) {
    return null;
  }

  const redirectLocation = await findAliasRedirectLocation(
    store,
    '',
    normalizedRequestPath,
    options,
  );
  if (!redirectLocation || redirectLocation === normalizedRequestPath) {
    return null;
  }

  return redirect(redirectLocation);
}

async function findAliasRedirectLocation(
  store: ContentStore,
  directoryPath: string,
  requestPath: string,
  options: HandleSiteRequestOptions,
): Promise<string | null> {
  const entries = await store.listDirectory(directoryPath);
  if (entries === null) {
    return null;
  }

  for (const entry of entries) {
    if (entry.kind === 'directory') {
      const nestedMatch = await findAliasRedirectLocation(
        store,
        entry.path,
        requestPath,
        options,
      );
      if (nestedMatch !== null) {
        return nestedMatch;
      }
      continue;
    }

    if (!isMarkdownEntry(entry)) {
      continue;
    }

    const document = await store.get(entry.path);
    if (document === null || document.kind !== 'text' || document.text === undefined) {
      continue;
    }

    const parsed = await parseMarkdownDocument(entry.path, document.text);
    if (parsed.meta.draft === true && options.draftMode === 'exclude') {
      continue;
    }

    const aliases = normalizeAliases(parsed.meta.aliases);
    if (!aliases.includes(requestPath)) {
      continue;
    }

    return getCanonicalHtmlPathForContentPath(entry.path);
  }

  return null;
}

function isMarkdownEntry(entry: ContentDirectoryEntry): boolean {
  return path.posix.extname(entry.name).toLowerCase() === '.md';
}

function isDirectoryIndexContentPath(contentPath: string): boolean {
  const basename = path.posix.basename(contentPath).toLowerCase();
  return basename === 'index.md' || basename === 'readme.md' || basename === 'skill.md';
}

function normalizeAliases(aliases: unknown): string[] {
  if (!Array.isArray(aliases)) {
    return [];
  }

  return aliases.flatMap((alias) => {
    if (typeof alias !== 'string') {
      return [];
    }

    const normalized = normalizeRequestPath(alias);
    return normalized === null ? [] : [normalized];
  });
}

function getCanonicalHtmlPathForContentPath(contentPath: string): string {
  const basename = path.posix.basename(contentPath).toLowerCase();
  if (
    basename === 'index.md' ||
    basename === 'readme.md' ||
    basename === 'skill.md'
  ) {
    const directory = path.posix.dirname(contentPath);
    return directory === '.' ? '/' : `/${directory}/`;
  }

  return `/${contentPath.slice(0, -'.md'.length)}`;
}

function isRssEnabled(siteConfig: ResolvedSiteConfig): boolean {
  return Boolean(siteConfig.siteUrl) && (siteConfig.rss?.enabled ?? true);
}

function getRssFeedUrl(
  siteUrl: string | undefined,
  siteConfig: ResolvedSiteConfig,
  locale: ResolvedLocaleConfig | null,
): string | undefined {
  if (!siteUrl || !isRssEnabled(siteConfig)) {
    return undefined;
  }

  const feedPath =
    locale !== null && locale.pathPrefix !== ''
      ? `${locale.pathPrefix.slice(1)}/feed.xml`
      : 'feed.xml';
  return new URL(feedPath, ensureTrailingSlash(siteUrl)).toString();
}

function getEditLinkHref(
  siteConfig: ResolvedSiteConfig,
  sourcePath: string | undefined,
): string | undefined {
  if (!siteConfig.editLink || !sourcePath) {
    return undefined;
  }

  return `${siteConfig.editLink.baseUrl}${sourcePath}`;
}

async function resolveTopNav(
  store: ContentStore,
  siteConfig: ResolvedSiteConfig,
  localeConfig: ResolvedLocaleConfig | null = null,
): Promise<{ items: SiteNavItem[]; autoGenerated: boolean }> {
  if (localeConfig !== null && (localeConfig.topNav?.length ?? 0) > 0) {
    return {
      items: localeConfig.topNav,
      autoGenerated: false,
    };
  }

  if (siteConfig.topNav.length > 0) {
    return {
      items: siteConfig.topNav,
      autoGenerated: false,
    };
  }

  const contentRoot = localeConfig?.contentBase ?? '';
  const rootEntries = await store.listDirectory(contentRoot);
  if (rootEntries === null) {
    return {
      items: [],
      autoGenerated: false,
    };
  }

  const directories = rootEntries.filter((entry) => entry.kind === 'directory');
  const localeDirectoryNames = new Set(
    (siteConfig.locales ?? [])
      .filter((locale) => locale.contentBase !== '')
      .map((locale) => locale.contentBase),
  );
  const navItems: SiteNavItem[] = [];
  const orderedNavItems: Array<SiteNavItem & { order?: number }> = [];

  for (const entry of directories) {
    if (contentRoot === '' && localeDirectoryNames.has(entry.name)) {
      continue;
    }
    const resolved = await resolveDirectoryNav(store, entry);
    if (resolved.type !== 'page') {
      continue;
    }

    orderedNavItems.push({
      label: resolved.title,
      href: `${localeConfig?.pathPrefix ?? ''}/${entry.name}/`,
      order: resolved.order,
    });
  }

  orderedNavItems.sort((left, right) => {
    if (left.order !== undefined && right.order !== undefined) {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
    } else if (left.order !== undefined) {
      return -1;
    } else if (right.order !== undefined) {
      return 1;
    }

    return left.label.localeCompare(right.label);
  });

  navItems.push(...orderedNavItems.map(({ label, href }) => ({ label, href })));

  return {
    items: navItems,
    autoGenerated: navItems.length > 0,
  };
}

async function resolveDirectoryNav(
  store: ContentStore,
  entry: ContentDirectoryEntry,
): Promise<{ title: string; type: 'page' | 'post'; order?: number }> {
  for (const candidatePath of getDirectoryIndexCandidates(entry.path)) {
    const contentEntry = await store.get(candidatePath);
    if (contentEntry === null || contentEntry.kind !== 'text' || contentEntry.text === undefined) {
      continue;
    }

    const parsed = await parseMarkdownDocument(candidatePath, contentEntry.text);
    const shape = await inspectDirectoryShape(store, entry.path);

    return {
      title: getParsedDocumentTitle(parsed.meta, parsed.body, entry.name),
      type: inferDirectoryContentType(parsed.meta, shape),
      order: parsed.meta.order,
    };
  }

  return {
    title: entry.name,
    type: 'page',
  };
}

async function inspectDirectoryShape(
  store: ContentStore,
  directoryPath: string,
): Promise<{
  hasSkillIndex: boolean;
  hasChildDirectories: boolean;
  hasExtraMarkdownFiles: boolean;
  hasAssetFiles: boolean;
}> {
  const entries = await store.listDirectory(directoryPath);
  if (entries === null) {
    return {
      hasSkillIndex: false,
      hasChildDirectories: false,
      hasExtraMarkdownFiles: false,
      hasAssetFiles: false,
    };
  }

  return inspectDirectoryShapeEntries(entries);
}

function inspectDirectoryShapeEntries(
  entries: readonly ContentDirectoryEntry[],
): {
  hasSkillIndex: boolean;
  hasChildDirectories: boolean;
  hasExtraMarkdownFiles: boolean;
  hasAssetFiles: boolean;
} {
  let hasSkillIndex = false;
  let hasChildDirectories = false;
  let hasExtraMarkdownFiles = false;
  let hasAssetFiles = false;

  for (const entry of entries) {
    if (isIgnoredContentName(entry.name)) {
      continue;
    }

    if (entry.kind === 'directory') {
      hasChildDirectories = true;
      continue;
    }

    const extension = path.posix.extname(entry.name).toLowerCase();
    if (extension === '.md') {
      if (entry.name === 'SKILL.md') {
        hasSkillIndex = true;
      } else if (entry.name !== 'index.md' && entry.name !== 'README.md') {
        hasExtraMarkdownFiles = true;
      }
      continue;
    }

    hasAssetFiles = true;
  }

  return {
    hasSkillIndex,
    hasChildDirectories,
    hasExtraMarkdownFiles,
    hasAssetFiles,
  };
}
