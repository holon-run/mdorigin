---
title: Routing Model
order: 10
date: 2026-03-20
summary: Understand how markdown, HTML, directory routes, and assets map to URLs.
---

# Routing Model

Given a content root:

```text
docs/site/
  README.md
  guides/
    README.md
    getting-started.md
```

`mdorigin` resolves routes like this:

- `README.md` -> `/README.md`
- directory homepage -> `/` using `index.md`, or `README.md` if `index.md` is absent
- skill homepage -> `/skill-name/` using `SKILL.md` when neither `index.md` nor `README.md` exists
- `guides/getting-started.md` -> `/guides/getting-started.md`, `/guides/getting-started.html`, `/guides/getting-started`
- sitemap -> `/sitemap.xml`
- RSS feed -> `/feed.xml` when `siteUrl` is configured and RSS is not disabled

If a directory has no `index.md`, the current runtime can still render a minimal fallback listing for browsing.

Directory homepages are canonical with a trailing slash. When `/guides/` is a valid directory route, requesting `/guides` redirects to `/guides/`.

The content tree may also include directory symlinks. `mdorigin` follows them in local preview and build-time processing, while keeping the published URL based on the visible path inside the content root.

`/sitemap.xml` emits canonical HTML URLs, not `.md` source URLs. It requires `siteUrl` so the sitemap can use absolute locations.

`/feed.xml` also requires `siteUrl`, because feed items use absolute canonical URLs.

Rendered HTML also exposes the source markdown path with:

```html
<link rel="alternate" type="text/markdown" href="/foo.md">
```

This is a lightweight interoperability hint for agents and tools that want to discover the raw markdown source from the human HTML page.

For missing routes, `mdorigin` renders an HTML 404 page for human HTML requests, while markdown, asset, and API misses stay machine-friendly.

When RSS is enabled, rendered HTML also exposes feed autodiscovery:

```html
<link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml">
```

## Canonical markdown paths

Directory homepages support `index.md`, `README.md`, and `SKILL.md`, but only one can act as the effective source file for a given directory.

- if the real file is `README.md`, requesting `index.md` redirects to `README.md`
- if the real file is `index.md`, requesting `README.md` redirects to `index.md`
- if a directory only has `SKILL.md`, `/dir/` renders it and `/dir/SKILL.md` remains the raw markdown path

This keeps raw markdown URLs canonical while still letting directories use either filename.

## Skill bundle support

Skill repositories often use:

- `SKILL.md`
- `scripts/`
- `references/`
- `assets/`

When `mdorigin` sees `SKILL.md` in a directory, it treats that directory as a document bundle by default.

- the directory is rendered as one published document
- parent indexes treat it as an article entry, not a section entry
- helper files under `scripts/`, `references/`, `assets/`, or `templates/` remain directly accessible by path
- those helper directories do not participate in automatic content indexing

## Accept negotiation

Explicit paths remain stable:

- `/foo.md` always returns markdown
- `/foo.html` always returns HTML

Extensionless routes can negotiate on `Accept`:

- `/foo`
- `/`
- `/guides/`

When the request includes `Accept: text/markdown`, those routes return raw markdown instead of HTML.

For negotiated routes, responses include:

- `Vary: Accept`

Example:

```bash
curl -H "Accept: text/markdown" http://localhost:3000/guides/getting-started
```

## Aliases

Documents may declare old paths in frontmatter with `aliases`.

When a request matches one of those aliases, `mdorigin` returns a `308` redirect to the current canonical HTML route:

- directory homepages redirect to `/dir/`
- regular documents redirect to `/dir/name`

Example:

```md
---
aliases:
  - /old-guides
  - /legacy/getting-started
---
```

## Multilingual routes

When `locales` is configured, non-default languages keep content under a top-level directory named after the locale code, and URLs carry the matching prefix:

```text
docs/site/
  README.md          # default language (unprefixed)
  guides/
  zh-CN/             # /zh-CN/
    README.md
    guides/
```

- default-language content lives at the content root with unprefixed URLs
- other languages live under `{code}/` with the URL prefix matching the directory name, e.g. `/zh-CN/guides/`
- missing translations return 404; there is no automatic language fallback
- the page header renders a language switcher, and `<head>` emits `hreflang` alternates only for translations that exist
- RSS is per language: the default language keeps `/feed.xml`, others get `/{code}/feed.xml`
