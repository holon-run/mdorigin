---
title: Cloudflare Deployment
order: 20
date: 2026-03-20
summary: Build a user-project Worker bundle and initialize Wrangler config.
---

# Cloudflare Deployment

`mdorigin` does not ship a repo-owned `wrangler.toml`. Instead, it generates a Worker bundle for the consuming project.

Recommended install:

```bash
npm install -g mdorigin
```

Project-local install also works with `npm install --save-dev mdorigin`.

## Build a Worker bundle

```bash
mdorigin build cloudflare --root docs/site
```

By default this writes:

```text
dist/cloudflare/worker.mjs
```

For media-heavy sites, use external binary mode:

```bash
mdorigin build cloudflare --root docs/site --binary-mode external
```

In external mode:

- text content stays embedded in `worker.mjs`
- smaller binaries are staged under `dist/cloudflare/assets`
- oversized binaries are staged under `dist/cloudflare/r2`
- generated Wrangler config wires the staged asset directory to the `ASSETS` binding
- dotfiles and dot-directories are ignored during traversal

When `--search <search-dir>` is provided to `build cloudflare`, the search bundle is also externalized for Cloudflare deployments:

- search files are not embedded into `worker.mjs`
- smaller search files are staged under `dist/cloudflare/assets/__mdorigin/search`
- oversized search files are staged under `dist/cloudflare/r2`
- `/api/search` loads the staged index lazily at runtime

## Initialize Wrangler config

```bash
mdorigin init cloudflare --dir .
```

If the bundle contains R2-backed binaries, pass the bucket name:

```bash
mdorigin init cloudflare --dir . --r2-bucket <bucket-name>
```

Upload staged R2 objects before deploying:

```bash
mdorigin sync cloudflare-r2 --dir dist/cloudflare --bucket <bucket-name>
```

This upload step can be required by large media files, large search bundle files, or both.

If `--name` is omitted, `mdorigin` derives the Worker name from the site title.

You can deploy to the default `*.workers.dev` hostname first. A custom domain is optional and can be added later from the user project's Cloudflare setup.

For production deployment, set `siteUrl` in `mdorigin.config.json` so rendered HTML and `/sitemap.xml` can use the correct absolute origin.

After deployment, extensionless routes on the Worker can also return markdown when a client sends:

```http
Accept: text/markdown
```

That lets agents fetch markdown directly from the site domain without adding `.md` to the URL.

## Caching behavior

Deployed sites are cached at several layers so repeated traffic does not re-render every request:

- **Static assets** — generated Wrangler config serves assets directly from the Cloudflare asset CDN before the Worker runs.
- **Browser and edge caches** — rendered responses carry a deploy-versioned `ETag`, `Cache-Control: public, max-age=120, stale-while-revalidate=604800` for browsers, and `CDN-Cache-Control: max-age=86400` for the Cloudflare edge on non-negotiated routes. Conditional requests with a matching `If-None-Match` receive `304` without rendering.
- **Worker-internal caches** — within one isolate, rendered responses are memoized (default 100 entries), and each colo additionally uses the Cloudflare Cache API. Cache keys include the deploy version and the `html`/`md` representation, so Accept-negotiated routes never cross-contaminate and every cache entry is invalidated automatically on the next deploy.
- **Search** — `/api/search` results are memoized per isolate because the search index is static within a deploy.

To observe cache hits in responses, set a Worker variable:

```jsonc
{
  "vars": {
    "MDORIGIN_CACHE_DEBUG": "1"
  }
}
```

Cacheable responses then expose `x-mdorigin-cache: miss | l1 | l2` describing whether the response was rendered fresh or served from the isolate/colo cache.
