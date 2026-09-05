---
title: Extensions
order: 20
date: 2026-03-28
summary: Stable plugin hooks, data structures, and page rendering contracts for code-based site customization.
---

# Extensions

`mdorigin` does not aim to become a template system. The extension model is code-first: `mdorigin` owns routing and normalized content semantics, and plugins can customize rendering on top of that kernel.

Use a code config such as `mdorigin.config.ts`:

```ts
import { defineConfig } from "mdorigin";

export default defineConfig({
  plugins: [
    {
      name: "custom-layout",
      renderPage(page, _context, next) {
        if (page.kind !== "listing") {
          return next(page);
        }

        const title = escapeHtml(page.title);
        return [
          "<!doctype html>",
          "<html><body>",
          `<main class="custom-listing"><h1>${title}</h1>${page.bodyHtml}</main>`,
          "</body></html>",
        ].join("");
      },
    },
  ],
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
```

## Stable Hook Surface

Current stable hooks:

- `transformIndex(entries, context)`
- `renderHeader(context)`
- `renderFooter(context)`
- `renderPage(page, context, next)`
- `transformHtml(html, context)`

These hooks are intended to be stable extension points. Internal request handling, routing internals, and storage internals are not plugin API.

## Core Data Structures

### `ManagedIndexEntry`

This is the normalized item shape used for generated directory indexes and default listing rendering.

```ts
type ManagedIndexEntry = {
  kind: "directory" | "article";
  title: string;
  href: string;
  detail?: string;
};
```

Field meanings:

- `kind`
  - `directory` for section-like entries
  - `article` for document-like entries
- `title`
  - the display label
- `href`
  - the published link, usually canonical HTML
- `detail`
  - optional secondary text, usually summary or date + summary

### `IndexTransformContext`

This is passed to `transformIndex`.

```ts
type IndexTransformContext = {
  mode: "build" | "render";
  directoryPath?: string;
  requestPath?: string;
  sourcePath?: string;
  siteConfig?: ResolvedSiteConfig;
};
```

Field meanings:

- `mode`
  - `build` during `mdorigin build index`
  - `render` during HTML rendering
- `directoryPath`
  - filesystem directory currently being indexed during build
- `requestPath`
  - request URL path during render
- `sourcePath`
  - source markdown path for the current page, when available
- `siteConfig`
  - resolved site config during render

### `PageRenderModel`

This is the stable page model passed into `renderPage` and included in `RenderHookContext`.

```ts
type PageRenderModel = {
  kind: "page" | "listing";
  requestPath: string;
  sourcePath: string;
  locale: string;
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
};
```

The most important fields in practice are:

- `kind`
  - `page` or `listing`
- `requestPath`
  - current published path, such as `/guides/getting-started`
- `sourcePath`
  - source markdown path inside the content tree
- `locale`
  - effective UI locale for the request, such as `en` or `zh-CN`
- `languages`
  - language switcher entries for multilingual sites; each entry carries `code`, `label`, `href`, `current`, and `translated`
- `title`
  - normalized page title
- `meta`
  - normalized markdown frontmatter, including custom fields
- `bodyHtml`
  - already-rendered markdown body HTML
- `summary` and `date`
  - normalized metadata when enabled
- `topNav`, `footerNav`, `socialLinks`
  - normalized site navigation data
- `listingEntries`
  - managed index entries for listing-like pages
- `canonicalPath`
  - canonical HTML route
- `alternateMarkdownPath`
  - raw markdown route
- `searchEnabled`
  - whether the search UI/API is enabled for this site

### `PageLanguage`

Language switcher entries on `PageRenderModel` use this shape:

```ts
type PageLanguage = {
  code: string;
  label: string;
  href: string;
  current: boolean;
  translated: boolean;
};
```

`href` points at the translated page when one exists and falls back to that language's home otherwise.

### `RenderHookContext`

This is passed to render hooks:

```ts
type RenderHookContext = {
  page: PageRenderModel;
  siteConfig: ResolvedSiteConfig;
};
```

Important contract:

- `context.page` reflects the current page model at the moment the hook runs
- if a `renderPage` plugin calls `next(modifiedPage)`, downstream hooks see that modified page model

## Hook Contracts

### `transformIndex(entries, context)`

Use this to modify generated index entries before they are rendered.

Typical uses:

- reorder entries
- filter entries
- inject custom entries
- group directories and articles differently

Example:

```ts
transformIndex(entries) {
  return entries.filter((entry) => entry.title !== "Draft Notes");
}
```

### `renderHeader(context)`

Return a string to replace the built-in header. If multiple plugins return strings, the last returned string wins.

Typical uses:

- custom masthead
- custom nav wrapper
- product banner

### `renderFooter(context)`

Return a string to replace the built-in footer. If multiple plugins return strings, the last returned string wins.

Typical uses:

- custom footer layout
- policy links
- brand-specific footer markup

### `renderPage(page, context, next)`

This is the most powerful current hook. It can fully replace page rendering.

Rules:

- return a string to finish rendering immediately
- call `next(page)` to continue through the plugin chain with the provided page model
- if you call `next(modifiedPage)`, downstream renderers and `transformHtml` receive the modified page model

Typical uses:

- custom listing layout
- custom document shell
- alternate article presentation
- layout changes that go beyond header/footer replacement

Example:

```ts
renderPage(page, _context, next) {
  if (page.kind !== "listing") {
    return next(page);
  }

  const title = escapeHtml(page.title);
  return [
    "<!doctype html>",
    "<html><body>",
    `<main class="listing-grid"><h1>${title}</h1>${page.bodyHtml}</main>`,
    "</body></html>",
  ].join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
```

### `transformHtml(html, context)`

This runs after page rendering and receives the final HTML string plus the final page model.

Rules:

- it must return a string
- returning a non-string is treated as an error

Typical uses:

- inject analytics snippets
- add custom meta tags
- post-process generated markup

## What Plugins Should And Should Not Do

Plugins should do:

- customize layout and page rendering
- alter generated index entries
- inject final HTML additions

Plugins should not do:

- replace request routing
- depend on internal storage implementation details
- monkey-patch internal modules

The intended boundary is:

- `mdorigin` provides the publishing kernel
- plugins customize presentation and derived structures

## Recommended First Steps

Start with:

1. `renderFooter` if you only need footer customization
2. `transformIndex` if you want custom listing ordering or grouping
3. `renderPage` if you want a fully custom page or listing layout

For the rest of the configuration surface, see [Configuration](../reference/configuration.md).
