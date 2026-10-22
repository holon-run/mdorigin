---
title: Search and agent discovery
type: page
updated: 2026-10-22
summary: Configure indexing, canonical representations, agent discovery, and verifiable section citations.
---

# Search and agent discovery

Use this guide to make one published content tree readable by browsers, search
engines, and agents. These capabilities improve output correctness and navigation;
they do not guarantee ranking, rich results, or AI citations.

## Prerequisites

- A patched Node.js version; development and CI use `.nvmrc` (24.22.1).
- A [site configuration](../reference/configuration.md) with a real `siteUrl`.
- [Build search](../reference/cli.md) if you want the optional search API.

## Configure discovery

```json
{
  "siteUrl": "https://example.com",
  "llmsTxt": true,
  "structuredData": true
}
```

The generated `/llms.txt` lists Markdown pages by locale and section, plus the
OpenAPI/search entry points. It excludes drafts, noindex pages, and duplicate
canonical URLs. The directory is limited to 200 pages and 32 KB, not a full-text
export. A content-root `llms.txt` always takes precedence, even with generation
disabled; use it to curate a larger site. There is no automatic `llms-full.txt`.

HTML and Markdown responses advertise the optional directory using HTTP
`Link: ...; rel="describedby"`. Explicit `.md` responses and negotiated Markdown
also carry a canonical Link to the HTML page. Markdown is **not** automatically
marked noindex.

## Choose indexing and crawler policy separately

```yaml
---
title: An accessible but unlisted page
robots:
  index: false
  follow: true
  maxSnippet: 120
search: false
---
```

`robots` produces matching HTML meta and `X-Robots-Tag` directives on every
representation. `noindex: true` is a shorthand for `robots.index: false`.
Such pages are omitted from sitemap, feeds, and generated agent discovery, but
remain accessible. Site search is independent: only `search: false` excludes
the document from its next search build. Neither setting is authentication.

Use `robots.rules` to choose crawler-specific policy explicitly:

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

This is an example policy, not a default. Without rules, the generated
`robots.txt` only declares the configured Sitemap URL. A user-owned
`robots.txt` always wins. Do not disallow crawling of a noindex page if a
cooperating crawler needs to read its noindex directive.

## Describe content honestly

Use `date` for publication, `updated` for the last substantive content update,
and `author` for a real person or array of names. Quote date values if precision
matters. Valid formats are ISO calendar dates or timestamps with explicit
timezones. Invalid values are omitted, never replaced with the build time.

With `structuredData: true`, explicit `type: post` produces `BlogPosting`;
other pages produce `WebPage`. Author and publication/modification dates come
from the same normalized page model; missing values are not invented.
`showSummary` and `showDate` do not erase search or social metadata.

## Search and cite a section

```bash
mdorigin build search --root docs/site --out dist/search
curl 'https://example.com/api/search?q=cloudflare&topK=5'
curl -H 'Accept: text/markdown' 'https://example.com/guides/cloudflare'
```

Search results keep page-level `canonicalUrl` and may add `citationUrl` with a
rendered heading fragment. Heading IDs are deterministic across repeated
headings, inline formatting, and non-Latin text; explicit HTML IDs are respected.
Rebuild indexes created before this capability to include content revisions.

Citations are omitted for stale content, ambiguous repeated excerpts, missing
source pages, and legacy indexes. `charStart`/`charEnd` are indexbind's search
content coordinates (UTF-8 byte offsets in 0.6.x), **not** stable offsets in the
raw Markdown file. Do not implement raw-file range reads using them.

## Verify before and after deployment

- `npm run check && npm test && npm run build` checks the framework contracts.
- The test suite evaluates 30 labelled English/Chinese tasks plus three negative
  queries on the actual docs, in hashing/vector and hashing/hybrid modes. It
  reports Recall@5, MRR, empty-result rates, response size, and citation landing
  correctness. These are reproducible development baselines, not model2vec or
  production quality claims; no ranking threshold is asserted.
- A listing's `?page=2` URL should have a self canonical and real previous/next
  links. Disable JavaScript to verify that all entries remain reachable.
- After deployment, inspect the final `robots.txt`, sitemap, HTML/Markdown
  headers, and generated discovery URLs. CDN/WAF behavior may differ from local
  output. Local tests do not prove that real search crawlers can reach the site.
- Use the site's search-platform and analytics data to establish a consistent
  baseline. Do not mistake bot traffic for citations or claim traffic gains
  from schema/discovery-file output alone. No automatic IndexNow submission is
  performed.
