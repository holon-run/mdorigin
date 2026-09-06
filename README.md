# mdorigin

`mdorigin` is a markdown-first publishing engine.

It treats markdown as the only source of truth, serves raw `.md` directly for agents, renders HTML for humans from the same directory tree, and can expose the same content to both browsers and tools through stable routes.

## Core Principle

`mdorigin` is not meant to become a template system.

Its core is:

- routing rules
- markdown tree normalization
- document, index, asset, search, and site semantics
- stable page models derived from the same content tree

That means `mdorigin` should own content semantics, while page rendering remains extensible. In practice, this is the direction for advanced customization: users should be able to replace page-level rendering with code, without replacing the routing and content kernel itself.

## Why mdorigin

- markdown stays directly accessible at `.md` routes
- extensionless routes render human-friendly HTML from the same files
- `README.md`, `index.md`, and `SKILL.md` all fit into one routing model
- the same core works in local preview and Cloudflare Workers
- optional search is powered by [`indexbind`](https://github.com/holon-run/indexbind)

## Install

```bash
npm install -g mdorigin
```

Then run it directly:

```bash
mdorigin dev --root docs/site
```

If you prefer a project-local install instead, use `npm install --save-dev mdorigin` and run it with `npx --no-install mdorigin ...`.

## Quick Start

```bash
mdorigin dev --root docs/site
mdorigin build index --root docs/site
mdorigin build cloudflare --root docs/site
```

That is enough to preview a site locally, keep directory indexes up to date, and generate a Cloudflare Worker bundle.

## Code-Based Extensions

`mdorigin` now supports a code config alongside `mdorigin.config.json`.

Use `mdorigin.config.ts` when you want to customize rendering or indexing with code instead of asking for a template system:

```ts
export default {
  siteTitle: "My Site",
  plugins: [
    {
      name: "custom-footer",
      renderFooter() {
        return '<footer class="custom-footer">Built with mdorigin</footer>';
      },
    },
  ],
};
```

Current stable hooks are:

- `transformIndex(entries, context)`
- `renderHeader(context)`
- `renderFooter(context)`
- `renderPage(page, context, next)`
- `transformHtml(html, context)`

All render hooks that receive a `RenderHookContext` (`renderHeader`, `renderFooter`, `renderPage`, and `transformHtml`) can read the normalized markdown frontmatter for the current document via `context.page.meta`, including custom fields such as `syndication`.

The intended boundary is:

- `mdorigin` owns routing and normalized content semantics
- plugins may replace page rendering
- plugins do not replace the request kernel itself

## Optional Search

`mdorigin` can build a local retrieval bundle through the optional [`indexbind`](https://github.com/holon-run/indexbind) package. For the retrieval engine itself, see the `indexbind` docs: <https://indexbind.jolestar.workers.dev>.

```bash
npm install indexbind
mdorigin build search --root docs/site
mdorigin search --index dist/search "cloudflare deploy"
```

`build search` now defaults to the higher-quality `model2vec` backend. If you need a smaller or faster fallback, you can opt back into hashing:

```bash
mdorigin build search --root docs/site --embedding-backend hashing
```

To expose the same search bundle from the site runtime:

```bash
mdorigin dev --root docs/site --search dist/search
mdorigin build cloudflare --root docs/site --search dist/search
```

For media-heavy sites that would exceed Worker bundle limits, build in external binary mode instead:

```bash
mdorigin build cloudflare --root docs/site --binary-mode external
mdorigin sync cloudflare-r2 --dir dist/cloudflare --bucket <bucket-name>
mdorigin init cloudflare --dir . --r2-bucket <bucket-name>
```

In this mode, markdown and other text stay embedded in the Worker bundle, smaller binaries are staged for Workers Static Assets, and oversized binaries are staged for R2.

`mdorigin` ignores dotfiles and dot-directories during content traversal. `.gitignore` is not used to decide publish visibility.

Runtime endpoints:

- `/api/search?q=cloudflare+deploy`
- `/api/openapi.json`

## Docs

- Docs site: <https://mdorigin.holon.run>
- Getting started: [`docs/site/guides/getting-started.md`](docs/site/guides/getting-started.md)
- Routing model: [`docs/site/concepts/routing.md`](docs/site/concepts/routing.md)
- Directory indexes: [`docs/site/concepts/directory-indexes.md`](docs/site/concepts/directory-indexes.md)
- Configuration: [`docs/site/reference/configuration.md`](docs/site/reference/configuration.md)
- CLI: [`docs/site/reference/cli.md`](docs/site/reference/cli.md)
- Search setup: [`docs/site/guides/getting-started.md`](docs/site/guides/getting-started.md#quick-start)
- Cloudflare deployment: [`docs/site/guides/cloudflare.md`](docs/site/guides/cloudflare.md)

The docs site at <https://mdorigin.holon.run> is deployed automatically from `main` with GitHub Actions.
