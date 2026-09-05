---
title: 配置
order: 10
date: 2026-03-20
summary: 站点级配置字段及其行为。
---

# 配置

站点配置位于内容根目录。

支持的配置入口文件：

- `<content-root>/mdorigin.config.ts`
- `<content-root>/mdorigin.config.mjs`
- `<content-root>/mdorigin.config.js`
- `<content-root>/mdorigin.config.json`

多个文件同时存在时，`mdorigin` 优先 `.ts`，其次 `.mjs`、`.js`、`.json`。

常用字段：

- `siteTitle`
- `siteDescription`
- `locale`
- `messages`
- `locales`
- `siteUrl`
- `favicon`
- `socialImage`
- `logo`
- `topNav`
- `footerNav`
- `footerText`
- `socialLinks`
- `editLink`
- `showHomeIndex`
- `listingInitialPostCount`
- `listingLoadMoreStep`
- `search`
- `showDate`
- `showSummary`
- `stylesheet`
- `plugins`

## 代码配置

当你想要基于代码的定制而非纯静态设置时，使用 `mdorigin.config.ts`。

示例：

```ts
import { defineConfig } from "mdorigin";

export default defineConfig({
  siteTitle: "My Site",
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

`defineConfig` 是可选的，直接默认导出普通对象也可以。

当前稳定插件钩子：

- `transformIndex(entries, context)`
- `renderHeader(context)`
- `renderFooter(context)`
- `renderPage(page, context, next)`
- `transformHtml(html, context)`

设计边界是：

- `mdorigin` 拥有路由与内容语义
- 插件可以整体替换页面渲染
- 插件不应该替换请求内核本身

## 本地化

`mdorigin` 从类型化消息目录本地化内置 UI 文案（搜索面板、footer 操作、列表标签、404 页），内置 `en` 与 `zh-CN` 两份目录。

单语言站点设置：

```json
{
  "locale": "zh-CN"
}
```

规则：

- `locale` 接受 BCP 47 编码，默认 `en`
- 未知语言静默回退英文目录，不报错
- `<html lang>` 跟随生效 locale；页面可用 frontmatter 的 `lang` 字段覆盖
- 任意内置文案都可以按平铺 key 通过 `messages` 覆盖：

```json
{
  "locale": "zh-CN",
  "messages": {
    "search.toggle": "搜一下"
  }
}
```

多语言内容站点改用 `locales` 配置。每个语言的内容放在以语言代码命名的顶层目录中，与 URL 前缀一一对应：

```json
{
  "siteUrl": "https://example.com",
  "locales": [
    { "code": "en", "default": true },
    { "code": "zh-CN", "label": "中文" }
  ]
}
```

按上面的配置：

- 英文内容位于内容根，提供无前缀 URL
- 中文内容位于 `zh-CN/` 目录，提供 `/zh-CN/...` URL
- 页面渲染头部语言切换器，并只为实际存在的译文输出 `hreflang` 互链（含 `x-default`）
- 译文缺失返回 404，不回退到其他语言
- `/feed.xml` 只包含默认语言；其他语言各有 `/{code}/feed.xml`
- 搜索结果在客户端按当前语言过滤
- 语言目录不出现在自动推导的顶部导航中

各语言字段：

- `locales[].code`（必填）：BCP 47 编码，同时是内容目录名
- `locales[].label`：切换器显示名，默认取编码
- `locales[].default`：必须恰好标记一个语言为 `true`
- `locales[].pathPrefix`：`""`（仅默认语言，内容在根目录）或 `"/{code}"`；其他值会被拒绝
- `locales[].messages`：该语言的文案覆盖，优先于全局 `messages`

默认语言也可以显式设置 `pathPrefix`（如 `/en`）；此时其内容位于 `en/` 目录，`/` 重定向到 `/en/`。

## 站点元数据

- 如果配置了 `siteTitle`，直接使用。
- 否则 `mdorigin` 回退到根首页 frontmatter：
  - `title` -> `siteTitle`
  - `summary` -> `siteDescription`
- 如果配置与根首页 frontmatter 都没有提供，`siteTitle` 回退为 `mdorigin`。

## 导航

- 如果配置了 `topNav`，`mdorigin` 直接使用。
- 如果 `topNav` 缺省或为空，`mdorigin` 从内容根一级子目录推导导航。
- 自动推导的导航只包含被视为 `type: page` 的目录。
- 被视为 `type: post` 的目录被排除在自动推导的顶部导航之外。
- 当根首页已有顶部导航时，HTML 视图会从受管根索引块中隐藏重复的 `page` 条目，只保留剩余条目（如文章）。
- `footerNav` 始终显式配置，不从内容树自动推导。

## 品牌信息

- `siteUrl` 设置规范站点源，用于渲染 HTML 中的规范链接。
- `siteUrl` 同时启用 `/sitemap.xml`，输出绝对规范 URL。
- 除非显式禁用 RSS，`siteUrl` 默认启用 `/feed.xml`。
- `favicon` 添加标准 favicon 链接标签。
- `socialImage` 在设置 `siteUrl` 时输出绝对 `og:image` 与 `twitter:image` 元数据。
- `logo` 在 header 渲染一个小站点 logo。

示例：

```json
{
  "siteUrl": "https://example.com",
  "favicon": "/favicon.svg",
  "socialImage": "/og.svg",
  "logo": {
    "src": "/logo.svg",
    "alt": "Example"
  }
}
```

## RSS

`mdorigin` 可以在 `/feed.xml` 输出内置 RSS 订阅。

规则：

- 设置 `siteUrl` 后默认启用 RSS
- 设置 `"rss": false` 禁用订阅
- 订阅输出带日期的文章内容，而不是树中所有页面
- 启用订阅后，渲染 HTML 添加 RSS 自动发现 `<link rel="alternate" ...>`

可选覆盖：

```json
{
  "rss": {
    "title": "Example Feed",
    "description": "Latest updates from Example",
    "author": "editor@example.com",
    "maxItems": 20
  }
}
```

支持字段：

- `rss.title`
- `rss.description`
- `rss.author`
- `rss.maxItems`

## Footer

`mdorigin` 支持一小组显式 footer 设置：

- `footerNav`
- `footerText`
- `socialLinks`
- `editLink`

示例：

```json
{
  "footerNav": [
    { "label": "GitHub", "href": "https://github.com/example/repo" }
  ],
  "footerText": "Built with mdorigin.",
  "socialLinks": [
    { "icon": "github", "label": "GitHub", "href": "https://github.com/example/repo" }
  ],
  "editLink": {
    "baseUrl": "https://github.com/example/repo/edit/main/docs/"
  }
}
```

内置社交图标当前包括：

- `github`
- `npm`
- `rss`
- `x`
- `home`

`footerText` 没有隐式默认值。省略时 `mdorigin` 不会自行渲染 footer 文案。

## 默认呈现

`mdorigin` 内置一种呈现。

- 使用默认 atlas 风格基线
- 普通页面与受管索引列表使用相同的外层文档外壳
- 如果你想要不同的布局或样式，使用 `stylesheet` 或基于代码的钩子，而不是选择内置主题/模板变体

当页面包含受管索引块时，默认渲染器把文章条目转换为结构化列表，并支持增量 `Load more` 分批。可以用以下配置调整列表行为：

```json
{
  "listingInitialPostCount": 10,
  "listingLoadMoreStep": 10
}
```

规则：

- `listingInitialPostCount` 控制首个 HTML 响应渲染多少文章条目
- `listingLoadMoreStep` 控制每次 `Load more` 请求追加多少文章条目
- 目录条目始终完整渲染；限制只作用于受管列表中的文章条目
- 两个字段默认都是 `10`

## 搜索配置

当站点通过 `mdorigin dev --search ...` 或部署的搜索 API 暴露搜索包时，`mdorigin` 可以应用站点级搜索配置。

示例：

```json
{
  "search": {
    "topK": 10,
    "mode": "hybrid",
    "minScore": 0.05,
    "reranker": {
      "kind": "embedding-v1",
      "candidatePoolSize": 25
    },
    "scoreAdjustment": {
      "metadataNumericMultiplier": "directory_weight"
    }
  }
}
```

支持字段：

- `search.topK`
- `search.mode`
- `search.minScore`
- `search.reranker.kind`
- `search.reranker.candidatePoolSize`
- `search.scoreAdjustment.metadataNumericMultiplier`
- `search.policy.shortQuery`
- `search.policy.longQuery`

规则：

- `search.topK` 设置请求未自带 `topK` 时 `/api/search` 的默认结果数
- `search.mode` 接受 `hybrid` 或 `vector`
- `search.minScore` 在最终打分后丢弃弱尾匹配
- `search.reranker` 配置可选的最终重排阶段
- `search.scoreAdjustment.metadataNumericMultiplier` 指向应乘以最终得分的数值元数据字段
- `search.policy` 可选；省略时 mdorigin 只使用静态站点级搜索配置
- `search.policy.shortQuery.maxChars` 与 `search.policy.longQuery.minChars` 按去空格后的 Unicode 码点长度匹配
- 两个阈值对同一查询重叠时，`shortQuery` 优先
- 策略条目可设置 `mode`、`minScore`、`reranker` 或 `scoreAdjustment`
- 在策略条目内，`null` 显式清除继承值（如默认重排器或得分调整）
- `/api/search` 仍保持很小的公共面：`q`、`topK` 与 `meta.<field>`
- 检索模式、重排器选择、得分调整与分数截断保留在站点配置中，而不是公共查询参数

查询感知策略示例：

```json
{
  "search": {
    "mode": "hybrid",
    "topK": 10,
    "minScore": 0.02,
    "policy": {
      "shortQuery": {
        "maxChars": 6,
        "minScore": 0.02,
        "reranker": null
      },
      "longQuery": {
        "minChars": 12,
        "reranker": {
          "kind": "heuristic-v1",
          "candidatePoolSize": 20
        }
      }
    }
  }
}
```

## 目录类型

目录首页文件可在 frontmatter 声明内容类型：

```md
---
title: Projects
type: page
---
```

```md
---
title: Why mdorigin exists
type: post
---
```

规则：

- `type: page` 用于章节、落地页与可导航集合
- `type: post` 用于文章容器，如带同目录资源的 `post/README.md`
- 省略 `type` 时，`mdorigin` 使用轻量推断，且不把结果写回 frontmatter

## Order

Markdown frontmatter 可以定义 `order`：

```md
---
title: Getting Started
order: 10
---
```

规则：

- `order` 值小的在前
- `order` 用于自动推导的顶部导航与目录索引生成
- 缺省时，`mdorigin` 回退到默认排序规则

## 渲染开关

- `showDate` 控制解析出的 markdown 日期是否在默认呈现使用它们的地方显示
- `showSummary` 控制配置的摘要是否在默认呈现使用它们的地方显示
- 两个开关默认 `true`

## 别名

Markdown frontmatter 可以定义应重定向到当前规范路由的旧 URL：

```md
---
title: Hello
aliases:
  - /hello-world
  - /old/hello
---
```

规则：

- `aliases` 可以是字符串或字符串数组
- 别名请求返回 `308` 重定向
- 别名重定向到当前文档的规范 HTML 路由
- 目录首页重定向到 `/dir/`
- 普通 markdown 文档重定向到 `/dir/name`
- exclude 模式下草稿文档不暴露别名
