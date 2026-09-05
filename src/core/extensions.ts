import type { ManagedIndexEntry, ParsedDocumentMeta } from './markdown.js';
import type {
  EditLinkConfig,
  ResolvedSiteConfig,
  SiteLogo,
  SiteNavItem,
  SiteSocialLink,
} from './site-config.js';

type MaybePromise<T> = T | Promise<T>;

export interface IndexTransformContext {
  mode: 'build' | 'render';
  directoryPath?: string;
  requestPath?: string;
  sourcePath?: string;
  siteConfig?: ResolvedSiteConfig;
}

export interface PageLanguage {
  code: string;
  label: string;
  /** Root-relative href for this language: the translated page when available, otherwise the language home. */
  href: string;
  current: boolean;
  /** Whether a page-level translation exists for this language. */
  translated: boolean;
}

export interface PageRenderModel {
  kind: 'page' | 'listing';
  requestPath: string;
  sourcePath: string;
  /** Effective UI locale for this request (frontmatter overrides not applied). */
  locale: string;
  /** Language switcher entries; empty for single-language sites. */
  languages: PageLanguage[];
  siteTitle: string;
  siteDescription?: string;
  siteUrl?: string;
  favicon?: string;
  socialImage?: string;
  logo?: SiteLogo;
  title: string;
  meta: ParsedDocumentMeta;
  bodyHtml: string;
  summary?: string;
  date?: string;
  showSummary: boolean;
  showDate: boolean;
  topNav: SiteNavItem[];
  footerNav: SiteNavItem[];
  footerText?: string;
  socialLinks: SiteSocialLink[];
  editLink?: EditLinkConfig;
  editLinkHref?: string;
  stylesheetContent?: string;
  canonicalPath?: string;
  alternateMarkdownPath?: string;
  listingEntries: ManagedIndexEntry[];
  listingRequestPath: string;
  listingInitialPostCount: number;
  listingLoadMoreStep: number;
  searchEnabled: boolean;
}

export interface RenderHookContext {
  page: PageRenderModel;
  siteConfig: ResolvedSiteConfig;
}

export interface MdoPlugin {
  name?: string;
  transformIndex?(
    entries: ManagedIndexEntry[],
    context: IndexTransformContext,
  ): MaybePromise<ManagedIndexEntry[]>;
  renderHeader?(context: RenderHookContext): MaybePromise<string | undefined | null>;
  renderFooter?(context: RenderHookContext): MaybePromise<string | undefined | null>;
  renderPage?(
    page: PageRenderModel,
    context: RenderHookContext,
    next: (page: PageRenderModel) => MaybePromise<string>,
  ): MaybePromise<string | undefined | null>;
  transformHtml?(html: string, context: RenderHookContext): MaybePromise<string>;
}

export async function applyIndexTransforms(
  entries: ManagedIndexEntry[],
  plugins: MdoPlugin[],
  context: IndexTransformContext,
): Promise<ManagedIndexEntry[]> {
  let current = [...entries];
  for (const plugin of plugins) {
    if (!plugin.transformIndex) {
      continue;
    }

    current = [...(await plugin.transformIndex(current, context))];
  }

  return current;
}

export async function renderHeaderOverride(
  plugins: MdoPlugin[],
  context: RenderHookContext,
): Promise<string | undefined> {
  let rendered: string | undefined;
  for (const plugin of plugins) {
    if (!plugin.renderHeader) {
      continue;
    }

    const value = await plugin.renderHeader(context);
    if (typeof value === 'string') {
      rendered = value;
    }
  }

  return rendered;
}

export async function renderFooterOverride(
  plugins: MdoPlugin[],
  context: RenderHookContext,
): Promise<string | undefined> {
  let rendered: string | undefined;
  for (const plugin of plugins) {
    if (!plugin.renderFooter) {
      continue;
    }

    const value = await plugin.renderFooter(context);
    if (typeof value === 'string') {
      rendered = value;
    }
  }

  return rendered;
}

export async function renderPageWithPlugins(
  page: PageRenderModel,
  plugins: MdoPlugin[],
  context: RenderHookContext,
  renderDefault: (page: PageRenderModel) => MaybePromise<string>,
): Promise<{ html: string; page: PageRenderModel }> {
  const renderers = plugins
    .map((plugin) => plugin.renderPage)
    .filter((renderPage): renderPage is NonNullable<MdoPlugin['renderPage']> =>
      typeof renderPage === 'function',
    );

  let finalPage = page;

  const dispatch = async (index: number, currentPage: PageRenderModel): Promise<string> => {
    const renderPage = renderers[index];
    if (!renderPage) {
      finalPage = currentPage;
      return renderDefault(currentPage);
    }

    const currentContext: RenderHookContext = {
      ...context,
      page: currentPage,
    };
    let nextInvoked = false;
    const next = async (nextPage: PageRenderModel) => {
      nextInvoked = true;
      finalPage = nextPage;
      return dispatch(index + 1, nextPage);
    };
    const rendered = await renderPage(currentPage, currentContext, next);
    if (typeof rendered === 'string') {
      if (!nextInvoked) {
        finalPage = currentPage;
      }
      return rendered;
    }

    return next(currentPage);
  };

  return {
    html: await dispatch(0, page),
    page: finalPage,
  };
}

export async function transformHtmlWithPlugins(
  html: string,
  plugins: MdoPlugin[],
  context: RenderHookContext,
): Promise<string> {
  let current = html;
  for (const plugin of plugins) {
    if (!plugin.transformHtml) {
      continue;
    }

    const result = await plugin.transformHtml(current, context);
    if (typeof result !== 'string') {
      const pluginName = plugin.name ?? 'unknown plugin';
      throw new Error(
        `transformHtmlWithPlugins expected plugin "${pluginName}" to return a string, but got ${typeof result}`,
      );
    }

    current = result;
  }

  return current;
}
