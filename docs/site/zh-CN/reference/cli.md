---
title: CLI
order: 20
date: 2026-03-20
summary: 本地预览、索引生成与 Cloudflare 包的命令行入口。
---

# CLI

推荐安装：

```bash
npm install -g mdorigin
```

项目内安装也可以：

```bash
npm install --save-dev mdorigin
```

主要命令：

- `mdorigin dev --root <content-dir>`
- `mdorigin dev --root <content-dir> --search <search-dir>`
- `mdorigin build index --root <content-dir> --config <config-file>`
- `mdorigin build search --root <content-dir> --config <config-file>`
- `mdorigin build search --root <content-dir> --embedding-backend hashing`
- `mdorigin build search --root <content-dir> --incremental`
- `mdorigin build cloudflare --root <content-dir> --config <config-file> --search <search-dir> --binary-mode external`
- `mdorigin init cloudflare --dir . --r2-bucket <bucket-name>`
- `mdorigin sync cloudflare-r2 --dir <cloudflare-out-dir> --bucket <bucket-name>`
- `mdorigin search --index <search-dir> --meta type=post <query>`

项目内安装时，通过 `npx --no-install mdorigin ...` 运行相同命令。

有用的默认行为：

- `dev`、`build index`、`build search`、`build cloudflare` 都接受 `--config`
- `build search` 默认写入 `dist/search`，除非提供 `--out`
- `build search` 默认使用 `model2vec` 嵌入后端
- `build search --incremental` 在输出目录旁保留 `indexbind` 缓存，加速重复构建
- `build cloudflare` 默认写入 `dist/cloudflare/worker.mjs`，除非提供 `--out`
- `build cloudflare` 默认 `--binary-mode inline`；使用 `--binary-mode external` 把二进制分阶段到 Worker 包之外
- 当给 `build cloudflare` 传入 `--search` 时，搜索文件在 Cloudflare 部署中始终分阶段到 Worker 包之外，仍使用 `--assets-max-bytes` / `--r2-binding`
- `init cloudflare` 默认指向 `dist/cloudflare/worker.mjs`
- `init cloudflare` 省略 `--name` 时从 `siteTitle` 推导 Worker 名称
- `sync cloudflare-r2` 上传所有 R2 分阶段文件（包括外置的搜索文件），未变更的上传会被跳过，除非设置 `--force`

搜索命令需要可选的 `indexbind` 包：

```bash
npm install indexbind
```

`indexbind` 运行时与索引细节见：

- 文档：<https://indexbind.jolestar.workers.dev>
- 仓库：<https://github.com/holon-run/indexbind>

强制使用较旧的轻量后端：

```bash
mdorigin build search --root docs/site --embedding-backend hashing
```

当给 `dev` 或 `build cloudflare` 传入 `--search` 时，站点暴露：

- `/api/search?q=...`
- `/api/openapi.json`

搜索元数据过滤可通过：

- 重复的 CLI 标志，如 `mdorigin search --index dist/search --meta type=post --meta section=guides "cloudflare"`
- 查询参数，如 `/api/search?q=cloudflare&meta.type=post&meta.section=guides`

内容遍历忽略点文件与点目录。`.gitignore` 不影响发布行为。
