import type {
  SiteLogo,
  SiteNavItem,
  SiteSocialLink,
} from '../core/site-config.js';
import type { ManagedIndexEntry } from '../core/markdown.js';
import {
  DEFAULT_SITE_LOCALE,
  resolveSiteMessages,
  serializeMessagesForScript,
  type SiteMessages,
} from '../i18n/messages.js';
import { getDefaultThemeStyles } from './theme.js';

export interface RenderDocumentOptions {
  siteTitle: string;
  siteDescription?: string;
  locale?: string;
  messages?: SiteMessages;
  siteUrl?: string;
  favicon?: string;
  socialImage?: string;
  logo?: SiteLogo;
  title: string;
  body: string;
  summary?: string;
  date?: string;
  showSummary?: boolean;
  showDate?: boolean;
  topNav?: SiteNavItem[];
  footerNav?: SiteNavItem[];
  footerText?: string;
  socialLinks?: SiteSocialLink[];
  editLinkHref?: string;
  stylesheetContent?: string;
  canonicalPath?: string;
  alternateMarkdownPath?: string;
  rssFeedUrl?: string;
  listingEntries?: ManagedIndexEntry[];
  listingRequestPath?: string;
  listingInitialPostCount?: number;
  listingLoadMoreStep?: number;
  searchEnabled?: boolean;
  headerHtml?: string;
  footerHtml?: string;
}

export function renderDocument(options: RenderDocumentOptions) {
  const locale = options.locale ?? DEFAULT_SITE_LOCALE;
  const messages = options.messages ?? resolveSiteMessages(locale);
  const title = escapeHtml(options.title);
  const siteTitle = escapeHtml(options.siteTitle);
  const siteDescription = options.siteDescription
    ? escapeHtml(options.siteDescription)
    : undefined;
  const summaryMeta = options.summary
    ? `<meta name="description" content="${escapeHtml(options.summary)}">`
    : '';
  const canonicalMeta =
    options.siteUrl && options.canonicalPath
      ? `<link rel="canonical" href="${escapeHtml(
          `${options.siteUrl}${options.canonicalPath}`,
        )}">`
      : '';
  const faviconMeta = options.favicon
    ? `<link rel="icon" href="${escapeHtml(options.favicon)}">`
    : '';
  const absoluteSocialImageUrl = getAbsoluteSiteAssetUrl(options.siteUrl, options.socialImage);
  const socialImageMeta = absoluteSocialImageUrl
    ? [
        `<meta property="og:image" content="${escapeHtml(absoluteSocialImageUrl)}">`,
        '<meta name="twitter:card" content="summary_large_image">',
        `<meta name="twitter:image" content="${escapeHtml(absoluteSocialImageUrl)}">`,
      ].join('')
    : '';
  const alternateMarkdownMeta = options.alternateMarkdownPath
    ? `<link rel="alternate" type="text/markdown" href="${escapeHtml(
        options.alternateMarkdownPath,
      )}">`
    : '';
  const rssMeta = options.rssFeedUrl
    ? `<link rel="alternate" type="application/rss+xml" title="${siteTitle}" href="${escapeHtml(
        options.rssFeedUrl,
      )}">`
    : '';
  const stylesheetBlock = `<style>${getDefaultThemeStyles()}${
    options.stylesheetContent ? `\n${options.stylesheetContent}` : ''
  }</style>`;
  const navBlock =
    options.topNav && options.topNav.length > 0
      ? `<nav class="site-nav"><ul>${options.topNav
          .map(
            (item) =>
              `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></li>`,
          )
          .join('')}</ul></nav>`
      : '';
  const searchToggleBlock = options.searchEnabled
    ? [
        '<div class="site-search" data-site-search>',
        `<button type="button" class="site-search__toggle" aria-expanded="false" aria-controls="site-search-panel">${escapeHtml(messages['search.toggle'])}</button>`,
        '<div id="site-search-panel" class="site-search__panel" hidden>',
        '<form class="site-search__form" role="search" action="/api/search" method="get">',
        `<label class="site-search__label" for="site-search-input">${escapeHtml(messages['search.label'])}</label>`,
        '<div class="site-search__controls">',
        `<input id="site-search-input" class="site-search__input" type="search" name="q" placeholder="${escapeHtml(messages['search.placeholder'])}" autocomplete="off">`,
        `<button type="submit" class="site-search__submit">${escapeHtml(messages['search.go'])}</button>`,
        '</div>',
        `<p class="site-search__hint">${messages['search.hint']}</p>`,
        '</form>',
        '<div class="site-search__results" data-site-search-results></div>',
        '</div>',
        '</div>',
      ].join('')
    : '';
  const footerNavBlock =
    options.footerNav && options.footerNav.length > 0
      ? `<nav class="site-footer__nav"><ul>${options.footerNav
          .map(
            (item) =>
              `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></li>`,
          )
          .join('')}</ul></nav>`
      : '';
  const socialLinksBlock =
    options.socialLinks && options.socialLinks.length > 0
      ? `<ul class="site-footer__social">${options.socialLinks
          .map(
            (item) =>
              `<li><a href="${escapeHtml(item.href)}" aria-label="${escapeHtml(
                item.label,
              )}" title="${escapeHtml(item.label)}">${renderSocialIcon(item.icon)}</a></li>`,
          )
          .join('')}</ul>`
      : '';
  const siteDescriptionBlock = siteDescription
    ? `<span>${siteDescription}</span>`
    : '';
  const logoBlock = options.logo
    ? `<span class="site-header__logo"><img src="${escapeHtml(options.logo.src)}" alt="${escapeHtml(options.logo.alt ?? '')}"></span>`
    : '';
  const brandHref = escapeHtml(options.logo?.href ?? '/');
  const editLinkBlock = options.editLinkHref
    ? `<a class="site-footer__edit-link" href="${escapeHtml(options.editLinkHref)}">${escapeHtml(messages['footer.editPage'])}</a>`
    : '';
  const markdownViewBlock = options.alternateMarkdownPath
    ? `<a class="site-footer__markdown-link" href="${escapeHtml(options.alternateMarkdownPath)}" aria-label="${escapeHtml(messages['footer.markdownViewAria'])}">${escapeHtml(messages['footer.markdownView'])}</a>`
    : '';
  const footerActionsBlock =
    markdownViewBlock || editLinkBlock
      ? `<div class="site-footer__actions">${markdownViewBlock}${editLinkBlock}</div>`
      : '';
  const footerTextBlock = options.footerText
    ? `<p class="site-footer__text">${escapeHtml(options.footerText)}</p>`
    : '';
  const footerMetaBlock =
    socialLinksBlock || footerActionsBlock
      ? `<div class="site-footer__meta">${socialLinksBlock}${footerActionsBlock}</div>`
      : '';
  const footerBlock =
    footerNavBlock || footerTextBlock || footerMetaBlock
      ? `<footer class="site-footer"><div class="site-footer__inner">${footerNavBlock}${footerTextBlock}${footerMetaBlock}</div></footer>`
      : '';
  const articleBody =
    options.listingEntries && options.listingEntries.length > 0
      ? renderListingArticle(
          options.body,
          options.listingEntries,
          {
            requestPath: options.listingRequestPath ?? '/',
            initialPostCount: options.listingInitialPostCount ?? 10,
            loadMoreStep: options.listingLoadMoreStep ?? 10,
          },
          messages,
        )
      : options.body;
  const searchScript = options.searchEnabled ? renderSearchScript(messages) : '';

  const headerBlock =
    options.headerHtml ??
    `<header class="site-header"><div class="site-header__inner"><div class="site-header__brand"><p class="site-header__title"><a href="${brandHref}">${logoBlock}<span>${siteTitle}</span></a></p>${siteDescriptionBlock}</div><div class="site-header__actions">${navBlock}${searchToggleBlock}</div></div></header>`;
  const renderedFooterBlock = options.footerHtml ?? footerBlock;

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(locale)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title} | ${siteTitle}</title>`,
    summaryMeta,
    canonicalMeta,
    faviconMeta,
    socialImageMeta,
    alternateMarkdownMeta,
    rssMeta,
    stylesheetBlock,
    '</head>',
    '<body>',
    headerBlock,
    '<main>',
    `<article>${articleBody}</article>`,
    '</main>',
    renderedFooterBlock,
    searchScript,
    '</body>',
    '</html>',
  ].join('');
}

function getAbsoluteSiteAssetUrl(siteUrl: string | undefined, href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href) || href.startsWith('//')) {
    return href;
  }

  if (!siteUrl) {
    return undefined;
  }

  return new URL(href.replace(/^\//, ''), `${siteUrl}/`).toString();
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderSocialIcon(icon: string): string {
  switch (icon) {
    case 'github':
      return iconSvg(
        'M12 2C6.48 2 2 6.58 2 12.11c0 4.43 2.87 8.18 6.84 9.5.5.1.68-.22.68-.48 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.19-3.37-1.19-.46-1.17-1.11-1.48-1.11-1.48-.91-.63.07-.62.07-.62 1 .08 1.53 1.04 1.53 1.04.9 1.54 2.35 1.09 2.92.84.09-.66.35-1.09.63-1.34-2.22-.25-4.55-1.12-4.55-4.97 0-1.1.39-2 1.03-2.71-.1-.26-.45-1.29.1-2.68 0 0 .84-.27 2.75 1.03A9.4 9.4 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.91-1.3 2.75-1.03 2.75-1.03.55 1.39.2 2.42.1 2.68.64.71 1.03 1.61 1.03 2.71 0 3.86-2.33 4.72-4.56 4.97.36.31.68.91.68 1.84 0 1.33-.01 2.4-.01 2.73 0 .27.18.58.69.48A10.11 10.11 0 0 0 22 12.11C22 6.58 17.52 2 12 2Z',
      );
    case 'rss':
      return iconSvg(
        'M5 3a16 16 0 0 1 16 16h-3A13 13 0 0 0 5 6V3Zm0 6a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V9Zm0 6a4 4 0 0 1 4 4H5v-4Zm0 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
      );
    case 'npm':
      return iconSvg(
        'M3 7h18v10h-9v-8h-3v8H3V7Zm10 2h2v6h2V9h2v6h1V9h1V8h-8v1Z',
      );
    case 'x':
      return iconSvg(
        'M18.9 3H21l-6.87 7.85L22 21h-6.17l-4.83-6.32L5.47 21H3.36l7.35-8.4L2 3h6.32l4.37 5.77L18.9 3Zm-2.17 16h1.17L7.68 4H6.43l10.3 15Z',
      );
    case 'home':
      return iconSvg(
        'M12 3 3 10.2V21h6v-6h6v6h6V10.2L12 3Z',
      );
    default:
      return `<span class="site-footer__social-label">${escapeHtml(icon.slice(0, 1).toUpperCase())}</span>`;
  }
}

function iconSvg(pathData: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${pathData}"></path></svg>`;
}

function renderListingArticle(
  body: string,
  entries: ManagedIndexEntry[],
  options: {
    requestPath: string;
    initialPostCount: number;
    loadMoreStep: number;
  },
  messages: SiteMessages,
): string {
  if (entries.length === 0) {
    return body;
  }

  const directories = entries.filter((entry) => entry.kind === 'directory');
  const articles = entries.filter((entry) => entry.kind === 'article');
  const initialPostCount = Math.max(1, options.initialPostCount);
  const visibleArticles = articles.slice(0, initialPostCount);
  const shouldLoadMore = articles.length > visibleArticles.length;

  return [
    `<div class="catalog-page__body">${body}</div>`,
    `<section class="catalog-page" aria-label="${escapeHtml(messages['listing.ariaLabel'])}">`,
    directories.length > 0 ? renderListingDirectories(directories, messages) : '',
    articles.length > 0
      ? renderListingArticles(visibleArticles, {
          requestPath: options.requestPath,
          nextOffset: visibleArticles.length,
          loadMoreStep: options.loadMoreStep,
          hasMore: shouldLoadMore,
        }, messages)
      : '',
    '</section>',
    shouldLoadMore ? renderListingLoadMoreScript(messages) : '',
  ].join('');
}

function renderListingDirectories(
  entries: ManagedIndexEntry[],
  messages: SiteMessages,
): string {
  return [
    '<div class="catalog-list catalog-list--directories">',
    ...entries.map(
      (entry) =>
        `<a class="catalog-item catalog-item--directory" href="${escapeHtml(entry.href)}"><strong class="catalog-item__title">${escapeHtml(entry.title)}</strong>${
          entry.detail
            ? `<span class="catalog-item__detail">${escapeHtml(entry.detail)}</span>`
            : `<span class="catalog-item__detail">${escapeHtml(messages['listing.browseSection'])}</span>`
        }</a>`,
    ),
    '</div>',
  ].join('');
}

export function renderListingArticleItems(entries: readonly ManagedIndexEntry[]): string {
  return entries
    .map(
      (entry) =>
        `<a class="catalog-item" href="${escapeHtml(entry.href)}"><strong class="catalog-item__title">${escapeHtml(entry.title)}</strong>${
          entry.detail
            ? `<span class="catalog-item__detail">${escapeHtml(entry.detail)}</span>`
            : ''
        }</a>`,
    )
    .join('');
}

function renderListingArticles(
  entries: ManagedIndexEntry[],
  options: {
    requestPath: string;
    nextOffset: number;
    loadMoreStep: number;
    hasMore: boolean;
  },
  messages: SiteMessages,
): string {
  return [
    '<div class="catalog-list" data-listing-articles>',
    renderListingArticleItems(entries),
    '</div>',
    options.hasMore
      ? `<div class="catalog-load-more"><button type="button" class="catalog-load-more__button" data-listing-load-more data-request-path="${escapeHtml(
          options.requestPath,
        )}" data-next-offset="${escapeHtml(String(options.nextOffset))}" data-load-more-step="${escapeHtml(
          String(options.loadMoreStep),
        )}">${escapeHtml(messages['listing.loadMore'])}</button></div>`
      : '',
  ].join('');
}

function renderListingLoadMoreScript(messages: SiteMessages): string {
  return `<script>
(() => {
  const button = document.querySelector('[data-listing-load-more]');
  const list = document.querySelector('[data-listing-articles]');
  if (!(button instanceof HTMLButtonElement) || !(list instanceof HTMLElement)) {
    return;
  }

  const M = ${serializeMessagesForScript({
    loadMore: messages['listing.loadMore'],
    loading: messages['listing.loading'],
  })};

  const loadMore = async () => {
    const requestPath = button.dataset.requestPath;
    const nextOffset = button.dataset.nextOffset;
    const loadMoreStep = button.dataset.loadMoreStep;
    if (!requestPath || !nextOffset || !loadMoreStep) {
      return;
    }

    button.disabled = true;
    const previousLabel = button.textContent;
    button.textContent = M.loading;

    try {
      const url = new URL(requestPath, window.location.origin);
      url.searchParams.set('listing-format', 'posts');
      url.searchParams.set('listing-offset', nextOffset);
      url.searchParams.set('listing-limit', loadMoreStep);

      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error('Failed to load more posts');
      }

      const payload = await response.json();
      if (typeof payload.itemsHtml === 'string' && payload.itemsHtml !== '') {
        list.insertAdjacentHTML('beforeend', payload.itemsHtml);
      }

      if (payload.hasMore === true && typeof payload.nextOffset === 'number') {
        button.dataset.nextOffset = String(payload.nextOffset);
        button.disabled = false;
        button.textContent = previousLabel ?? M.loadMore;
        return;
      }

      button.remove();
    } catch {
      button.disabled = false;
      button.textContent = previousLabel ?? M.loadMore;
    }
  };

  button.addEventListener('click', () => {
    void loadMore();
  });
})();
</script>`;
}

function renderSearchScript(messages: SiteMessages): string {
  return [
    '<script>',
    '(function () {',
    '  const root = document.querySelector("[data-site-search]");',
    '  if (!root) return;',
    '  const toggle = root.querySelector(".site-search__toggle");',
    '  const panel = root.querySelector(".site-search__panel");',
    '  const form = root.querySelector(".site-search__form");',
    '  const input = root.querySelector(".site-search__input");',
    '  const results = root.querySelector("[data-site-search-results]");',
    '  if (!toggle || !panel || !form || !input || !results) return;',
    `  const M = ${serializeMessagesForScript({
      resultsEmpty: messages['search.resultsEmpty'],
      searching: messages['search.searching'],
      failed: messages['search.failed'],
      failedWithStatus: messages['search.failedWithStatus'],
      enterQuery: messages['search.enterQuery'],
      initialHint: messages['search.initialHint'],
      untitled: messages['search.untitled'],
    })};`,
    '  let controller = null;',
    '  function renderMessage(message) {',
    '    results.innerHTML = `<p class="site-search__message">${escapeHtmlForScript(message)}</p>`;',
    '  }',
    '  function renderHits(hits) {',
    '    if (!Array.isArray(hits) || hits.length === 0) {',
    '      renderMessage(M.resultsEmpty);',
    '      return;',
    '    }',
    '    results.innerHTML = hits.map((hit) => {',
    '      const href = escapeHtmlForScript(hit.canonicalUrl || hit.docId || "#");',
    '      const title = escapeHtmlForScript(hit.title || hit.relativePath || M.untitled);',
    '      const summary = typeof hit.summary === "string" ? `<span class="site-search__item-summary">${escapeHtmlForScript(hit.summary)}</span>` : "";',
    '      const excerpt = hit.bestMatch && typeof hit.bestMatch.excerpt === "string" ? `<span class="site-search__item-excerpt">${escapeHtmlForScript(hit.bestMatch.excerpt)}</span>` : "";',
    '      return `<a class="site-search__item" href="${href}"><strong class="site-search__item-title">${title}</strong>${summary}${excerpt}</a>`;',
    '    }).join("");',
    '  }',
    '  async function runSearch(query) {',
    '    if (controller) controller.abort();',
    '    controller = new AbortController();',
    '    renderMessage(M.searching);',
    '    try {',
    '      const url = new URL("/api/search", window.location.origin);',
    '      url.searchParams.set("q", query);',
    '      url.searchParams.set("topK", "8");',
    '      const response = await fetch(url, { signal: controller.signal });',
    '      if (!response.ok) {',
    '        renderMessage(M.failedWithStatus.replaceAll("{status}", String(response.status)));',
    '        return;',
    '      }',
    '      const payload = await response.json();',
    '      renderHits(payload.hits);',
    '    } catch (error) {',
    '      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;',
    '      renderMessage(M.failed);',
    '    }',
    '  }',
    '  function setOpen(open) {',
    '    toggle.setAttribute("aria-expanded", open ? "true" : "false");',
    '    panel.hidden = !open;',
    '    if (open) {',
    '      input.focus();',
    '      if (!results.innerHTML) renderMessage(M.initialHint);',
    '    }',
    '  }',
    '  toggle.addEventListener("click", () => setOpen(panel.hidden));',
    '  form.addEventListener("submit", (event) => {',
    '    event.preventDefault();',
    '    const query = input.value.trim();',
    '    if (!query) {',
    '      renderMessage(M.enterQuery);',
    '      return;',
    '    }',
    '    void runSearch(query);',
    '  });',
    '  document.addEventListener("keydown", (event) => {',
    '    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {',
    '      event.preventDefault();',
    '      setOpen(true);',
    '    }',
    '    if (event.key === "Escape" && !panel.hidden) setOpen(false);',
    '  });',
    '})();',
    '',
    'function escapeHtmlForScript(value) {',
    '  return String(value)',
    '    .replaceAll("&", "&amp;")',
    '    .replaceAll("<", "&lt;")',
    '    .replaceAll(">", "&gt;")',
    '    .replaceAll(\'"\', "&quot;")',
    '    .replaceAll("\\\'", "&#39;");',
    '}',
    '</script>',
  ].join('');
}
