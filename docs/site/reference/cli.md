---
title: CLI
order: 20
date: 2026-03-20
summary: Command-line entrypoints for local preview, index generation, and Cloudflare bundles.
---

# CLI

Recommended install:

```bash
npm install -g mdorigin
```

Project-local install also works:

```bash
npm install --save-dev mdorigin
```

Main commands:

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

With a project-local install, run the same commands via `npx --no-install mdorigin ...`.

Useful defaults:

- `dev`, `build index`, `build search`, and `build cloudflare` all accept `--config`
- `build search` writes to `dist/search` unless `--out` is provided
- `build search` defaults to the `model2vec` embedding backend
- `build search --incremental` keeps an `indexbind` cache beside the output directory to speed up repeated rebuilds
- `build cloudflare` writes to `dist/cloudflare/worker.mjs` unless `--out` is provided
- `build cloudflare` defaults to `--binary-mode inline`; use `--binary-mode external` to stage binaries outside the Worker bundle
- when `build cloudflare` is given `--search`, search files are always staged outside the Worker bundle for Cloudflare and still use `--assets-max-bytes` / `--r2-binding`
- `init cloudflare` points to `dist/cloudflare/worker.mjs` by default
- `init cloudflare` derives the Worker name from `siteTitle` when `--name` is omitted
- `sync cloudflare-r2` uploads all R2-staged files, including externalized search files, and skips unchanged uploads unless `--force` is set

Search commands require the optional `indexbind` package:

```bash
npm install indexbind
```

For `indexbind` runtime and indexing details, see:

- Docs: <https://indexbind.jolestar.workers.dev>
- Repository: <https://github.com/holon-run/indexbind>

To force the older lightweight backend:

```bash
mdorigin build search --root docs/site --embedding-backend hashing
```

When `dev` or `build cloudflare` is given `--search`, the site exposes:

- `/api/search?q=...`
- `/api/openapi.json`

Search metadata filters are available through:

- repeated CLI flags such as `mdorigin search --index dist/search --meta type=post --meta section=guides "cloudflare"`
- query parameters such as `/api/search?q=cloudflare&meta.type=post&meta.section=guides`

Content traversal ignores dotfiles and dot-directories. `.gitignore` does not affect publishing behavior.
