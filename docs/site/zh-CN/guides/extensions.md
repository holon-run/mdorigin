---
title: 扩展
order: 20
date: 2026-03-28
summary: 稳定的插件钩子、数据结构与页面渲染契约，用于基于代码的站点定制。
---

# 扩展

`mdorigin` 不打算成为模板系统。扩展模型是代码优先的：`mdorigin` 拥有路由与规范化内容语义，插件可以在该内核之上定制渲染。

使用代码配置，例如 `mdorigin.config.ts`：

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

## 稳定钩子面

当前稳定钩子：

- `transformIndex(entries, context)`
- `renderHeader(context)`
- `renderFooter(context)`
- `renderPage(page, context, next)`
- `transformHtml(html, context)`

这些钩子是稳定的扩展点。内部请求处理、路由内部与存储内部不属于插件 API。

## 核心数据结构

### `ManagedIndexEntry`

这是生成的目录索引与默认列表渲染使用的规范化条目形态。

```ts
type ManagedIndexEntry = {
  kind: "directory" | "article";
  title: string;
  href: string;
  detail?: string;
};
```

字段含义：

- `kind`
  - `directory` 表示章节类条目
  - `article` 表示文档类条目
- `title`
  - 显示标签
- `href`
  - 发布链接，通常是规范 HTML
- `detail`
  - 可选的次要文本，通常是摘要或日期 + 摘要

### `IndexTransformContext`

传递给 `transformIndex`。

```ts
type IndexTransformContext = {
  mode: "build" | "render";
  directoryPath?: string;
  requestPath?: string;
  sourcePath?: string;
  siteConfig?: ResolvedSiteConfig;
};
```

字段含义：

- `mode`
  - `mdorigin build index` 期间为 `build`
  - HTML 渲染期间为 `render`
- `directoryPath`
  - 构建期间正在索引的文件系统目录
- `requestPath`
  - 渲染期间的请求 URL 路径
- `sourcePath`
  - 当前页面的源 markdown 路径（可用时）
- `siteConfig`
  - 渲染期间已解析的站点配置

### `PageRenderModel`

这是传入 `renderPage` 并包含在 `RenderHookContext` 中的稳定页面模型。

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

实践中最重要的字段：

- `kind`
  - `page` 或 `listing`
- `requestPath`
  - 当前发布路径，如 `/guides/getting-started`
- `sourcePath`
  - 内容树内的源 markdown 路径
- `locale`
  - 本次请求生效的 UI locale，如 `en` 或 `zh-CN`
- `languages`
  - 多语言站点的语言切换器条目；每个条目含 `code`、`label`、`href`、`current` 与 `translated`
- `title`
  - 规范化页面标题
- `meta`
  - 规范化的 markdown frontmatter，包括自定义字段
- `bodyHtml`
  - 已渲染的 markdown 正文 HTML
- `summary` 与 `date`
  - 启用时的规范化元数据
- `topNav`、`footerNav`、`socialLinks`
  - 规范化的站点导航数据
- `listingEntries`
  - 列表类页面的受管索引条目
- `canonicalPath`
  - 规范 HTML 路由
- `alternateMarkdownPath`
  - 原始 markdown 路由
- `searchEnabled`
  - 站点是否启用搜索 UI/API

### `PageLanguage`

`PageRenderModel` 上的语言切换器条目使用以下形态：

```ts
type PageLanguage = {
  code: string;
  label: string;
  href: string;
  current: boolean;
  translated: boolean;
};
```

当对应译文存在时，`href` 指向翻译后的页面；否则回退到该语言的首页。

### `RenderHookContext`

传递给渲染钩子：

```ts
type RenderHookContext = {
  page: PageRenderModel;
  siteConfig: ResolvedSiteConfig;
};
```

重要契约：

- `context.page` 反映钩子运行时刻的当前页面模型
- 如果 `renderPage` 插件调用 `next(modifiedPage)`，下游钩子看到的是修改后的页面模型

## 钩子契约

### `transformIndex(entries, context)`

用它在渲染前修改生成的索引条目。

典型用途：

- 重排条目
- 过滤条目
- 注入自定义条目
- 以不同方式对目录与文章分组

示例：

```ts
transformIndex(entries) {
  return entries.filter((entry) => entry.title !== "Draft Notes");
}
```

### `renderHeader(context)`

返回字符串以替换内置 header。多个插件都返回字符串时，最后返回的生效。

典型用途：

- 自定义刊头
- 自定义导航容器
- 产品横幅

### `renderFooter(context)`

返回字符串以替换内置 footer。多个插件都返回字符串时，最后返回的生效。

典型用途：

- 自定义 footer 布局
- 政策链接
- 品牌专属 footer 标记

### `renderPage(page, context, next)`

这是当前最强大的钩子，可以整体替换页面渲染。

规则：

- 返回字符串则立即完成渲染
- 调用 `next(page)` 以传入的页面模型继续插件链
- 如果调用 `next(modifiedPage)`，下游渲染器与 `transformHtml` 收到修改后的页面模型

典型用途：

- 自定义列表布局
- 自定义文档外壳
- 另一种文章呈现
- 超出 header/footer 替换范围的布局变更

示例：

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

它在页面渲染之后运行，接收最终 HTML 字符串与最终页面模型。

规则：

- 必须返回字符串
- 返回非字符串视为错误

典型用途：

- 注入统计代码
- 添加自定义 meta 标签
- 后处理生成的标记

## 插件应该与不应该做什么

插件应该：

- 定制布局与页面渲染
- 修改生成的索引条目
- 注入最终的 HTML 附加内容

插件不应该：

- 替换请求路由
- 依赖内部存储实现细节
- 猴补内部模块

预期边界是：

- `mdorigin` 提供发布内核
- 插件定制呈现与派生结构

## 推荐起步顺序

从以下开始：

1. 只需要 footer 定制时，用 `renderFooter`
2. 想要自定义列表排序或分组时，用 `transformIndex`
3. 想要完全自定义页面或列表布局时，用 `renderPage`

其余配置面见[配置](../reference/configuration.md)。
