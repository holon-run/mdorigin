---
title: 搜索与 agent 发现
type: page
updated: 2026-10-22
summary: 配置索引控制、规范内容表示、agent 发现入口与可验证的章节引用。
---

# 搜索与 agent 发现

本指南用于让同一份已发布内容同时服务浏览器、搜索引擎与 agent。
这些能力改善输出正确性和导航，不保证搜索排名、富结果或 AI 引用。

## 前置条件

- 使用安全修复后的 Node.js；开发与 CI 通过 `.nvmrc` 固定为 24.22.1。
- 在[站点配置](../reference/configuration.md)中填写真实 `siteUrl`。
- 如果需要可选搜索 API，先[构建搜索索引](../reference/cli.md)。

## 配置发现入口

```json
{
  "siteUrl": "https://example.com",
  "llmsTxt": true,
  "structuredData": true
}
```

生成的 `/llms.txt` 按语言和栏目列出 Markdown 页面，并说明 OpenAPI 和搜索入口。
它不收录草稿、noindex 页面或重复 canonical，最多列出 200 页，正文预算为
32 KB，不是全文导出。内容根目录的 `llms.txt` 始终优先，即使关闭自动生成
也能提供用户文件；大站点可以用它维护精选目录。不自动生成 `llms-full.txt`。

HTML 和 Markdown 响应通过 HTTP `Link` 的 `describedby` 关系声明可选目录。
显式 `.md` 与协商得到的 Markdown 同时通过 canonical Link 指向规范 HTML 页面。
框架**不会**默认把 Markdown 标为 noindex。

## 区分索引控制与爬虫政策

```yaml
---
title: 可访问但不对外索引的页面
robots:
  index: false
  follow: true
  maxSnippet: 120
search: false
---
```

`robots` 在所有表示中生成一致的 HTML meta 与 `X-Robots-Tag`。
`noindex: true` 是 `robots.index: false` 的简写。
这类页面不进入 sitemap、feed 或自动 agent 目录，但仍可访问。
站内搜索独立控制：只有 `search: false` 才会在下一次索引构建时排除该文档。
这些设置都不是鉴权。

通过 `robots.rules` 显式选择爬虫政策：

```json
{
  "robots": {
    "rules": [
      { "userAgent": "OAI-SearchBot", "allow": ["/"] },
      { "userAgent": "GPTBot", "disallow": ["/"] }
    ]
  }
}
```

这只是政策示例，并非默认值。未配置规则时，生成的 `robots.txt` 只声明
已配置站点的 Sitemap URL；用户自带文件始终优先。
如果希望合作搜索引擎读取 noindex，就不要同时在 robots 中禁止抓取该页面。

## 如实描述内容

`date` 表示发布日期，`updated` 表示最后一次实质内容更新，`author` 表示
真实作者姓名或姓名数组。需要精确控制时，为日期值加引号；支持有效 ISO
日历日期与带显式时区的时间戳。无效值会被省略，不替换成构建时间。

开启 `structuredData` 后，显式 `type: post` 对应 `BlogPosting`，其他页面对应
`WebPage`。作者和日期来自同一份规范页面模型，不补造缺失信息。
`showSummary` 和 `showDate` 不会清空搜索或社交元数据。

## 搜索并引用章节

```bash
mdorigin build search --root docs/site --out dist/search
curl 'https://example.com/api/search?q=cloudflare&topK=5'
curl -H 'Accept: text/markdown' 'https://example.com/guides/cloudflare'
```

搜索结果保留页面级 `canonicalUrl`，并可能提供带真实标题锚点的 `citationUrl`。
标题 ID 对重复标题、内联格式和非拉丁文字具有确定性，并尊重显式 HTML ID。
旧索引需要重新构建，才能包含引用校验所需的内容 revision。

内容已变化、原文缺失、摘要重复导致定位有歧义、或索引过旧时，不返回章节引用。
`charStart`/`charEnd` 属于 indexbind 的搜索内容坐标（0.6.x 使用 UTF-8 字节），
不是原始 Markdown 的稳定偏移，不应直接用于原文范围读取。

## 部署前后验证

- `npm run check && npm test && npm run build` 检查框架输出契约。
- 测试集在真实文档上执行 30 个带相关性标注的中英任务和 3 个负向查询，比较
  hashing/vector 与 hashing/hybrid，记录 Recall@5、MRR、空结果率、响应大小和
  章节落点正确性。这是可复现的开发基线，不代表 model2vec 或生产质量；
  当前不以排名阈值作为测试门禁。
- 关闭 JavaScript，检查列表的 `?page=2` 等页面能遍历全部条目，且自指
  canonical 和真实前后页链接正确。
- 部署后检查最终 robots、sitemap、HTML/Markdown 响应头及目录链接。
  CDN/WAF 的行为可能不同于本地测试；单元测试不证明真实搜索爬虫可以访问。
- 用站点搜索平台和分析数据建立同口径基线，不把爬虫流量等同引用量，
  不因生成 schema 或目录文件就宣称流量增长。本能力不自动提交 IndexNow。
