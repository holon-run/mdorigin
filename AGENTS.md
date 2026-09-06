# AGENTS.md

## Project Snapshot
- Repo: `holon-run/mdorigin`
- Main branch is the active integration branch.
- npm package has been released through GitHub Actions trusted publishing.
- Cloudflare site deploys automatically from GitHub Actions on pushes to `main`.

## Core Product Direction
- `mdorigin` is a programmable publishing core.
- The kernel owns routing, content-tree normalization, markdown/raw dual-view behavior, search integration, and other site semantics.
- Page rendering is extensible.
- Request/runtime internals are not intended to be replaced by user extensions.

## Important Implemented Features
- Raw markdown and HTML dual views.
- `Accept: text/markdown` content negotiation on extensionless routes.
- `README.md`, `index.md`, and `SKILL.md` directory entry support.
- Skill bundles are treated as post bundles by default.
- Symlinked content directories are supported in dev, `build index`, and Cloudflare bundle generation.
- Search is powered by `indexbind`.
- UI i18n (`locale` + `messages`) and content-level multilingual sites (`locales` with per-language directories, hreflang, language switcher, per-locale feeds) are supported.
- Code-based extension system exists via `mdorigin.config.ts`.

## Extension System
- Current stable hooks:
  - `transformIndex`
  - `renderHeader`
  - `renderFooter`
  - `renderPage`
  - `transformHtml`
- `defineConfig` is exported from the package root.
- See docs:
  - `docs/site/guides/extensions.md`
  - `docs/site/reference/configuration.md`

## Search Notes
- Search API:
  - `/api/search`
  - `/api/openapi.json`
- Search UI is already integrated into the site.
- Search uses `indexbind@0.2.1`.
- Default embedding backend is `model2vec`.
- Site-side reranking exists in `mdorigin`:
  - overview pages are lightly penalized
  - same-section results get soft diversity reranking
- Hybrid retrieval, if added later, should primarily live in `indexbind`, not `mdorigin`.

## Release Workflows
- CI workflow: `.github/workflows/ci.yml`
- Release workflow: `.github/workflows/release.yml`
- Trusted publishing is already configured and working.
- Typical release flow:
  1. `npm version patch -m "0.1.x"`
  2. `git push origin main`
  3. `git push origin v0.1.x`
  4. Verify GitHub Actions `Publish`
  5. Verify `npm view mdorigin version`

## Cloudflare Deployment
- Site URL: `https://mdorigin.holon.run`
- Deployment runs automatically on pushes to `main` via `.github/workflows/deploy-cloudflare.yml`.
- The workflow uses this sequence:

```bash
npm run build
npm run build:search -- --root docs/site --out dist/search
npm run build:cloudflare -- --root docs/site --out dist/cloudflare --search dist/search
npx wrangler deploy
```

- Important: deploying without a fresh `npm run build` may push an outdated runtime from `dist/`.
- Required GitHub secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`

## Skills and Example Content
- `docs/site/skills` is a symlinked example skills section.
- `skills/mdorigin/SKILL.md` is the current mdorigin skill example.
- The skill intentionally stays concise and points agents to remote docs and `/api/search` for detail.

## Recent Known Good State
- npm version `0.1.8` was successfully released.
- Global CLI was updated and verified with `mdorigin --version`.
- Issue #10 was fixed in `0.1.8`:
  - managed index blocks now preserve explicit entry kind
  - catalog pagination correctly handles directory-based post bundles

## Recommended First Checks For New Agents
```bash
git status
git branch --show-current
mdorigin --version
npm view mdorigin version
```

## When Touching Site Output
- If a change affects rendered HTML, Cloudflare runtime, search runtime, or page footer/header behavior, rebuild before testing deployment.
- If a change lands in `main`, verify the `Deploy Cloudflare` workflow before assuming the public site is updated.
