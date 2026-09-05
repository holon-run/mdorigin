---
title: 路由模型
order: 10
date: 2026-03-20
summary: 理解 markdown、HTML、目录路由与资源如何映射到 URL。
---

# 路由模型

给定一个内容根目录：

```text
docs/site/
  README.md
  guides/
    README.md
    getting-started.md
```

`mdorigin` 按如下方式解析路由：

- `README.md` -> `/README.md`
- 目录首页 -> `/`，优先使用 `index.md`，不存在时使用 `README.md`
- 技能首页 -> `/skill-name/`，当 `index.md` 与 `README.md` 都不存在时使用 `SKILL.md`
- `guides/getting-started.md` -> `/guides/getting-started.md`、`/guides/getting-started.html`、`/guides/getting-started`
- 站点地图 -> `/sitemap.xml`
- RSS 订阅 -> 配置了 `siteUrl` 且未禁用 RSS 时提供 `/feed.xml`

如果某个目录没有 `index.md`，当前运行时仍可渲染一个最小化的兜底列表用于浏览。

目录首页以带尾斜杠的形式为规范地址。当 `/guides/` 是有效目录路由时，请求 `/guides` 会重定向到 `/guides/`。

内容树还可以包含目录符号链接。`mdorigin` 在本地预览与构建期处理中会跟随它们，同时保持发布 URL 基于内容根内部可见路径。

`/sitemap.xml` 输出规范 HTML URL，而不是 `.md` 源码 URL。它要求配置 `siteUrl`，站点地图才能使用绝对地址。

`/feed.xml` 同样要求 `siteUrl`，因为订阅条目使用绝对规范 URL。

渲染出的 HTML 还会暴露源 markdown 路径：

```html
<link rel="alternate" type="text/markdown" href="/foo.md">
```

这是一个轻量的互操作提示，方便希望从人类 HTML 页面发现原始 markdown 源码的智能体与工具。

对于缺失的路由，`mdorigin` 为人类 HTML 请求渲染 HTML 404 页，而 markdown、资源与 API 的未命中保持对机器友好的纯文本。

启用 RSS 后，渲染出的 HTML 还会暴露订阅自动发现：

```html
<link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml">
```

## 规范 markdown 路径

目录首页支持 `index.md`、`README.md` 与 `SKILL.md`，但对给定目录只有一个能作为实际源文件生效。

- 如果实际文件是 `README.md`，请求 `index.md` 会重定向到 `README.md`
- 如果实际文件是 `index.md`，请求 `README.md` 会重定向到 `index.md`
- 如果目录只有 `SKILL.md`，`/dir/` 渲染它，且 `/dir/SKILL.md` 仍是原始 markdown 路径

这让原始 markdown URL 保持规范，同时允许目录使用任一文件名。

## 技能包支持

技能仓库通常使用：

- `SKILL.md`
- `scripts/`
- `references/`
- `assets/`

当 `mdorigin` 在某目录看到 `SKILL.md` 时，默认把该目录当作一个文档包（document bundle）。

- 该目录作为一个发布文档渲染
- 父级索引把它当作文章条目，而不是章节条目
- `scripts/`、`references/`、`assets/`、`templates/` 下的辅助文件仍按路径直接可访问
- 这些辅助目录不参与自动内容索引

## Accept 协商

显式路径保持稳定：

- `/foo.md` 始终返回 markdown
- `/foo.html` 始终返回 HTML

无扩展名路由可以基于 `Accept` 协商：

- `/foo`
- `/`
- `/guides/`

当请求包含 `Accept: text/markdown` 时，这些路由返回原始 markdown 而不是 HTML。

对参与协商的路由，响应包含：

- `Vary: Accept`

示例：

```bash
curl -H "Accept: text/markdown" http://localhost:3000/guides/getting-started
```

## 别名

文档可以在 frontmatter 中用 `aliases` 声明旧路径。

当请求命中某个别名时，`mdorigin` 返回 `308` 重定向到当前规范 HTML 路由：

- 目录首页重定向到 `/dir/`
- 普通文档重定向到 `/dir/name`

示例：

```md
---
aliases:
  - /old-guides
  - /legacy/getting-started
---
```

## 多语言路由

配置 `locales` 后，非默认语言的内容放在以语言代码命名的顶层目录中，URL 带对应前缀：

```text
docs/site/
  README.md          # 默认语言（免前缀）
  guides/
  zh-CN/             # /zh-CN/
    README.md
    guides/
```

- 默认语言内容位于内容根，URL 不带前缀
- 其他语言位于 `{code}/` 目录，URL 前缀与目录名一致（如 `/zh-CN/guides/`）
- 译文缺失时直接 404，不做自动回退
- 页面头部渲染语言切换器，`<head>` 输出实际存在译文的 `hreflang` 互链
- RSS 按语言生成：默认语言保持 `/feed.xml`，其他语言为 `/{code}/feed.xml`
