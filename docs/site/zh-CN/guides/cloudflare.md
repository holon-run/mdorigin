---
title: Cloudflare 部署
order: 20
date: 2026-03-20
summary: 构建用户项目的 Worker 包并初始化 Wrangler 配置。
---

# Cloudflare 部署

`mdorigin` 不提供仓库内置的 `wrangler.toml`，而是为使用它的项目生成 Worker 包。

推荐安装：

```bash
npm install -g mdorigin
```

项目内安装 `npm install --save-dev mdorigin` 也可以。

## 构建 Worker 包

```bash
mdorigin build cloudflare --root docs/site
```

默认写入：

```text
dist/cloudflare/worker.mjs
```

媒体较多的站点，使用外置二进制模式：

```bash
mdorigin build cloudflare --root docs/site --binary-mode external
```

外置模式下：

- 文本内容保持嵌入 `worker.mjs`
- 较小的二进制文件分阶段放在 `dist/cloudflare/assets`
- 超大二进制文件分阶段放在 `dist/cloudflare/r2`
- 生成的 Wrangler 配置把分阶段的资源目录接入 `ASSETS` 绑定
- 遍历时忽略点文件与点目录

当给 `build cloudflare` 提供 `--search <search-dir>` 时，搜索包在 Cloudflare 部署中同样外置：

- 搜索文件不嵌入 `worker.mjs`
- 较小的搜索文件放在 `dist/cloudflare/assets/__mdorigin/search`
- 超大搜索文件放在 `dist/cloudflare/r2`
- `/api/search` 在运行时懒加载分阶段的索引

## 初始化 Wrangler 配置

```bash
mdorigin init cloudflare --dir .
```

如果包中包含 R2 支撑的二进制文件，传入桶名：

```bash
mdorigin init cloudflare --dir . --r2-bucket <bucket-name>
```

部署前上传分阶段的 R2 对象：

```bash
mdorigin sync cloudflare-r2 --dir dist/cloudflare --bucket <bucket-name>
```

大型媒体文件、大型搜索包文件（或两者）可能要求执行这一上传步骤。

如果省略 `--name`，`mdorigin` 会从站点标题推导 Worker 名称。

你可以先部署到默认的 `*.workers.dev` 主机名。自定义域名是可选的，之后可以在用户项目的 Cloudflare 设置中添加。

生产部署时，在 `mdorigin.config.json` 设置 `siteUrl`，让渲染 HTML 与 `/sitemap.xml` 使用正确的绝对源。

部署后，当客户端发送以下头时，Worker 上的无扩展名路由同样可以返回 markdown：

```http
Accept: text/markdown
```

这让智能体可以直接从站点域名获取 markdown，而无需在 URL 上追加 `.md`。

## 缓存行为

部署后的站点在多个层级被缓存，重复流量不会让每个请求都重新渲染：

- **静态资源** — 生成的 Wrangler 配置让资产在 Worker 运行之前由 Cloudflare 资产 CDN 直接返回。
- **浏览器与边缘缓存** — 渲染响应带部署版本化的 `ETag`，浏览器侧 `Cache-Control: public, max-age=120, stale-while-revalidate=604800`，非协商路由另有 `CDN-Cache-Control: max-age=86400` 供 Cloudflare 边缘缓存。`If-None-Match` 命中的条件请求直接返回 `304`，不触发渲染。
- **Worker 内缓存** — 同一 isolate 内渲染结果会被记忆化（默认 100 条），每个 colo 还会使用 Cloudflare Cache API。缓存键包含部署版本与 `html`/`md` 表示形式，Accept 协商路由不会互相污染，下一次部署会自动失效全部缓存条目。
- **搜索** — 搜索索引在一次部署内是静态的，因此 `/api/search` 结果按 isolate 记忆化。

要在响应中观察缓存命中情况，可设置 Worker 变量：

```jsonc
{
  "vars": {
    "MDORIGIN_CACHE_DEBUG": "1"
  }
}
```

之后可缓存响应会带 `x-mdorigin-cache: miss | l1 | l2` 头，标明响应是重新渲染还是来自 isolate/colo 缓存。
