export interface SiteMessages {
  'search.toggle': string;
  'search.label': string;
  'search.placeholder': string;
  'search.go': string;
  'search.hint': string;
  'search.resultsEmpty': string;
  'search.searching': string;
  'search.failed': string;
  'search.failedWithStatus': string;
  'search.enterQuery': string;
  'search.initialHint': string;
  'search.untitled': string;
  'footer.editPage': string;
  'footer.markdownView': string;
  'footer.markdownViewAria': string;
  'listing.browseSection': string;
  'listing.loadMore': string;
  'listing.loading': string;
  'listing.ariaLabel': string;
  'listing.emptyDirectory': string;
  'error.notFoundTitle': string;
  'error.notFoundBody': string;
}

export type SiteMessageKey = keyof SiteMessages;

export const DEFAULT_SITE_LOCALE = 'en';

/**
 * Built-in message catalogs. Messages are trusted template fragments: they may
 * contain inline HTML markup such as `<code>` and `{placeholder}` parameters.
 */
const enMessages: SiteMessages = {
  'search.toggle': 'Search',
  'search.label': 'Search site',
  'search.placeholder': 'Search docs and skills',
  'search.go': 'Go',
  'search.hint': 'Search is powered by <code>/api/search</code>.',
  'search.resultsEmpty': 'No results.',
  'search.searching': 'Searching...',
  'search.failed': 'Search failed.',
  'search.failedWithStatus': 'Search failed ({status}).',
  'search.enterQuery': 'Enter a search query.',
  'search.initialHint': 'Search docs, guides, and skills.',
  'search.untitled': 'Untitled',
  'footer.editPage': 'Edit this page',
  'footer.markdownView': 'MD View',
  'footer.markdownViewAria': 'View Markdown source',
  'listing.browseSection': 'Browse this section.',
  'listing.loadMore': 'Load more',
  'listing.loading': 'Loading...',
  'listing.ariaLabel': 'Content listing',
  'listing.emptyDirectory': 'This directory is empty.',
  'error.notFoundTitle': 'Not Found',
  'error.notFoundBody': 'No page was published at <code>{path}</code>.',
};

const zhCnMessages: SiteMessages = {
  'search.toggle': '搜索',
  'search.label': '搜索站点',
  'search.placeholder': '搜索文档与技能',
  'search.go': '搜索',
  'search.hint': '搜索由 <code>/api/search</code> 提供支持。',
  'search.resultsEmpty': '没有找到结果。',
  'search.searching': '搜索中...',
  'search.failed': '搜索失败。',
  'search.failedWithStatus': '搜索失败（{status}）。',
  'search.enterQuery': '请输入搜索关键词。',
  'search.initialHint': '搜索文档、指南与技能。',
  'search.untitled': '无标题',
  'footer.editPage': '编辑此页',
  'footer.markdownView': 'MD 视图',
  'footer.markdownViewAria': '查看 Markdown 源文件',
  'listing.browseSection': '浏览此章节。',
  'listing.loadMore': '加载更多',
  'listing.loading': '加载中...',
  'listing.ariaLabel': '内容列表',
  'listing.emptyDirectory': '此目录为空。',
  'error.notFoundTitle': '未找到',
  'error.notFoundBody': '没有页面发布在 <code>{path}</code>。',
};

const messageCatalogs: Record<string, SiteMessages> = {
  en: enMessages,
  'zh-CN': zhCnMessages,
};

const catalogKeys = new Map<string, string>(
  Object.keys(messageCatalogs).map((key) => [key.toLowerCase(), key]),
);

export function isKnownSiteLocale(locale: string): boolean {
  return messageCatalogs[locale] !== undefined;
}

/**
 * Resolves the effective message set for a locale: built-in English catalog,
 * overlaid with the built-in catalog for the locale (when available, unknown
 * locales fall back to English), overlaid with user overrides.
 */
export function resolveSiteMessages(
  locale: string | undefined,
  overrides?: Partial<SiteMessages>,
): SiteMessages {
  const catalogKey = locale === undefined ? undefined : catalogKeys.get(locale.toLowerCase());
  const catalog = catalogKey === undefined ? undefined : messageCatalogs[catalogKey];

  if (catalog === undefined || catalogKey === 'en') {
    return { ...enMessages, ...(overrides ?? {}) };
  }

  return { ...enMessages, ...catalog, ...(overrides ?? {}) };
}

export function formatSiteMessage(
  message: string,
  params: Record<string, string>,
): string {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    message,
  );
}

/**
 * Serializes messages for embedding inside an inline `<script>` element. `<`
 * is escaped so that a message containing `</script>` cannot terminate the
 * script block early.
 */
export function serializeMessagesForScript(
  messages: Record<string, string>,
): string {
  return JSON.stringify(messages).replaceAll('<', '\\u003c');
}

export function validateSiteMessages(
  value: unknown,
): { messages: Partial<SiteMessages>; unknownKeys: string[] } {
  const messages: Partial<SiteMessages> = {};
  const unknownKeys: string[] = [];

  if (typeof value !== 'object' || value === null) {
    return { messages, unknownKeys };
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!(key in enMessages)) {
      unknownKeys.push(key);
      continue;
    }

    if (typeof entry === 'string' && entry !== '') {
      messages[key as SiteMessageKey] = entry;
    }
  }

  return { messages, unknownKeys };
}
