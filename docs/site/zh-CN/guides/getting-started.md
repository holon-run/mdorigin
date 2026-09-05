---
title: 快速开始
order: 10
date: 2026-03-20
summary: 本地预览内容、配置站点并构建索引。
---

# 快速开始

## 快速上手

```bash
npm install -g mdorigin
mdorigin dev --root docs/site
mdorigin build index --root docs/site
```

这足以在本地预览站点、保持目录索引最新，并在接触部署之前确认内容模型。

之后要生成 Worker 包：

```bash
mdorigin build cloudflare --root docs/site
```

`mdorigin` 也非常适合与以 `SKILL.md` 为主文档的技能仓库配合。这类目录被视为文档包，而 `scripts/`、`references/` 等辅助目录保持直接可访问，但不进入自动索引。

如果你的发布内容在 `docs/site` 下，而可复用内容在仓库其他位置，也可以用目录符号链接暴露它。例如：

```text
docs/site/skills -> ../../skills
```

`mdorigin dev`、`mdorigin build index` 与 Cloudflare 包构建都会跟随这些符号链接目录。

开发期的本地检索，安装 `indexbind` 并构建搜索包：

```bash
npm install indexbind
mdorigin build search --root docs/site
mdorigin search --index dist/search --meta section=guides "cloudflare deploy"
```

`indexbind` 文档：

- 文档：<https://indexbind.jolestar.workers.dev>
- 仓库：<https://github.com/jolestar/indexbind>

`build search` 现在默认使用质量更高的 `model2vec` 后端。如果你想要更小的旧版回退，运行：

```bash
mdorigin build search --root docs/site --embedding-backend hashing
```

在本地预览时把同一个包暴露为站点 API：

```bash
mdorigin dev --root docs/site --search dist/search
```

可用端点：

- `/api/search?q=cloudflare+deploy`
- `/api/openapi.json`

也可以按元数据过滤搜索：

```bash
mdorigin search --index dist/search --meta type=post "cloudflare"
curl 'http://localhost:3000/api/search?q=cloudflare&meta.type=post'
```

如果你希望站点本身拥有默认检索配置，在 `mdorigin.config.*` 中配置：

```ts
import { defineConfig } from "mdorigin";

export default defineConfig({
  search: {
    topK: 10,
    mode: "hybrid",
    minScore: 0.05,
    reranker: {
      kind: "embedding-v1",
      candidatePoolSize: 25,
    },
  },
});
```

该配置作用于 `mdorigin dev --search ...` 与部署后的 `/api/search` 请求。HTTP API 仍只接受 `q`、可选的 `topK` 与 `meta.<field>` 过滤。

如果你的站点需要对短查询与较长说明式查询采用不同检索行为，可以添加可选的查询感知策略层：

```ts
import { defineConfig } from "mdorigin";

export default defineConfig({
  search: {
    topK: 10,
    mode: "hybrid",
    policy: {
      shortQuery: {
        maxChars: 6,
        minScore: 0.02,
        reranker: null,
      },
      longQuery: {
        minChars: 12,
        reranker: {
          kind: "heuristic-v1",
          candidatePoolSize: 20,
        },
      },
    },
  },
});
```

`mdorigin` 默认不启用任何动态搜索策略。如果 `search.policy` 缺省，站点只使用静态配置。

重复本地构建时，使用增量搜索索引：

```bash
mdorigin build search --root docs/site --incremental
```

## 安装

```bash
npm install -g mdorigin
```

如果偏好项目内安装，使用：

```bash
npm install --save-dev mdorigin
```

## 预览站点

使用一个内容根目录，例如 `docs/site`：

```bash
mdorigin dev --root docs/site
```

它会启动本地预览服务器，提供：

- 原始 markdown：`/foo.md`
- HTML：`/foo.html`
- 默认人类路由：`/foo`
- 当客户端发送 `Accept: text/markdown` 时，无扩展名路由返回 markdown

例如：

```bash
curl -H "Accept: text/markdown" http://localhost:3000/guides/getting-started
```

## 站点配置

在内容根内创建配置文件，例如 `docs/site/mdorigin.config.json` 或 `docs/site/mdorigin.config.ts`。

如果没有配置文件，`mdorigin` 回退到根首页 frontmatter：

- `title` 作为默认站点标题
- `summary` 作为默认站点描述

如果设置了 `stylesheet`，CSS 文件会被读取并内联进渲染 HTML，本地预览与 Cloudflare 包一致。默认情况下加载器按以下优先级：

1. `--config`
2. `<content-root>/mdorigin.config.ts`、`.mjs`、`.js` 或 `.json`
3. 当前工作目录的 `mdorigin.config.ts`、`.mjs`、`.js` 或 `.json`

内置呈现现在固定为默认 atlas 基线。直接配置元数据与导航：

```json
{
  "siteUrl": "https://example.com",
  "favicon": "/favicon.svg",
  "footerNav": [
    { "label": "GitHub", "href": "https://github.com/example/repo" }
  ]
}
```

设置 `siteUrl` 后，`mdorigin` 还会启用：

- `/sitemap.xml`
- `/feed.xml`

如果你想关闭 RSS 或覆盖订阅元数据，添加：

```json
{
  "rss": {
    "title": "Example Feed",
    "description": "Latest updates from Example",
    "maxItems": 20
  }
}
```

或完全禁用：

```json
{
  "rss": false
}
```

当页面包含受管索引块时，默认渲染器自动把它呈现为结构化列表。`mdorigin` 不再暴露内置主题/模板变体作为产品配置。

如果你想现在就开始使用基于代码的扩展，把 JSON 配置换成 `mdorigin.config.ts` 并导出带 `plugins` 的配置对象。

稳定的钩子、页面模型与插件数据结构见[扩展](./extensions.md)。

你仍然可以限制默认列表首批显示的文章条目数量：

```json
{
  "listingInitialPostCount": 10,
  "listingLoadMoreStep": 10
}
```

## 构建目录索引

```bash
mdorigin build index --root docs/site
```
