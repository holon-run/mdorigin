---
title: mdorigin
type: page
order: 0
date: 2026-03-20
summary: Markdown 优先的发布引擎，同时服务人类可读的 HTML 与智能体可读的原始 markdown。
---

# mdorigin

`mdorigin` 是一个面向人类与智能体（agents）的 markdown 优先发布引擎。

它让 markdown 保持直接可寻址，从同一批文件渲染无扩展名的 HTML，并可以把同一棵内容树发布到本地预览或 Cloudflare Workers。

如果想快速上手，从[快速开始](./guides/getting-started.md)开始，然后阅读[配置](./reference/configuration.md)、[扩展](./guides/extensions.md)与[Cloudflare 部署](./guides/cloudflare.md)。

## 核心原则

`mdorigin` 不是模板系统。它的内核是路由模型，以及从 markdown 树构建的规范化内容模型。

这意味着：

- `mdorigin` 拥有路由与内容语义
- 默认渲染内置提供
- 高级用户可以用代码整体替换页面渲染
- 扩展不应该需要替换请求管道本身

换句话说，`mdorigin` 是一个可编程的发布内核。扩展系统让用户可以在同一路由与内容内核之上构建自己的页面布局，包括目录式页面。

## 它能做什么

- 文件系统路由直接映射为发布路由
- `.md` 始终可以作为原始源码访问
- `.html` 与无扩展名路由从同一份 markdown 为人类渲染
- 相对路径的资源保持在内容旁边
- 同一内核同时服务本地 Node 预览与 Cloudflare Workers
- 可选的搜索与 `/api/search` 由 `indexbind` 提供支持
- `indexbind` 文档：<https://indexbind.jolestar.workers.dev>

## 项目说明

[为什么会有 mdorigin](./why-mdorigin.md) 用一页解释项目方向，并给出 markdown 优先模型最简短的论证。

顶部导航与各章节索引覆盖其余文档。

<!-- INDEX:START -->

- [指南](./guides/)
  <!-- mdorigin:index kind=directory -->

- [概念](./concepts/)
  <!-- mdorigin:index kind=directory -->

- [参考](./reference/)
  <!-- mdorigin:index kind=directory -->

- [为什么会有 mdorigin](./why-mdorigin.md)
  2026-03-20 · 简明解释 markdown 优先模型，以及本项目为什么避免纯运行时内容层。
  <!-- mdorigin:index kind=article -->

<!-- INDEX:END -->
