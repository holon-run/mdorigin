export function getDefaultThemeStyles(): string {
  return `${buildAtlasThemeStyles()}\n${buildSharedSearchStyles()}`;
}

function buildSharedSearchStyles(): string {
  return `
.site-header__actions {
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 1rem;
}
.site-search {
  position: relative;
}
.site-search__toggle {
  appearance: none;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--muted);
  border-radius: 999px;
  padding: 0.45rem 0.82rem;
  font: inherit;
  font-size: 0.88rem;
  cursor: pointer;
}
.site-search__toggle:hover {
  color: var(--text);
}
.site-search__panel {
  position: absolute;
  top: calc(100% + 0.7rem);
  right: 0;
  width: min(32rem, calc(100vw - 2rem));
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface) 95%, white 5%);
  box-shadow: 0 18px 40px rgba(24, 18, 11, 0.14);
  z-index: 2;
}
.site-search__label {
  display: block;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 0.55rem;
}
.site-search__controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.6rem;
}
.site-search__input,
.site-search__submit {
  font: inherit;
}
.site-search__input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  padding: 0.7rem 0.85rem;
}
.site-search__submit {
  appearance: none;
  border: 1px solid var(--text);
  border-radius: 12px;
  background: var(--text);
  color: var(--surface);
  padding: 0.7rem 0.95rem;
  cursor: pointer;
}
.site-search__hint,
.site-search__message {
  color: var(--muted);
  font-size: 0.84rem;
}
.site-search__results {
  margin-top: 0.9rem;
  display: grid;
  gap: 0.7rem;
}
.site-search__item {
  display: block;
  text-decoration: none;
  border-top: 1px solid var(--border);
  padding-top: 0.7rem;
}
.site-search__item:first-child {
  border-top: 0;
  padding-top: 0;
}
.site-search__item-title {
  display: block;
  color: var(--text);
}
.site-search__item-summary,
.site-search__item-excerpt {
  display: block;
  margin-top: 0.25rem;
  color: var(--muted);
  font-size: 0.88rem;
}
.site-search__item-excerpt {
  font-size: 0.82rem;
}
@media (max-width: 720px) {
  .site-header__actions {
    flex-direction: column;
    align-items: stretch;
  }
  .site-languages__panel {
    left: 0;
    right: auto;
  }
  .site-search__panel {
    left: 0;
    right: auto;
    width: min(100%, 34rem);
  }
}
`.trim();
}

function buildAtlasThemeStyles(): string {
  return `
:root {
  color-scheme: light;
  --bg: #eef3f8;
  --surface: #ffffff;
  --surface-alt: #f7fafc;
  --text: #102033;
  --muted: #5a6a7b;
  --border: #d7e1ec;
  --link: #0f5bd7;
  --link-hover: #0a3f98;
  --accent: #dbe9ff;
  --code-bg: #edf3ff;
  --max: 62rem;
}
* { box-sizing: border-box; }
html { font-size: 17px; }
body {
  margin: 0;
  background:
    linear-gradient(180deg, #f8fbff 0%, var(--bg) 52%, #f5f7fb 100%);
  color: var(--text);
  font-family: "Avenir Next", Avenir, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
  line-height: 1.7;
}
a { color: var(--link); text-decoration: none; }
a:hover { color: var(--link-hover); text-decoration: underline; }
.site-header {
  position: sticky;
  top: 0;
  z-index: 1;
  backdrop-filter: blur(14px);
  background: rgba(248, 251, 255, 0.88);
  border-bottom: 1px solid rgba(215, 225, 236, 0.88);
}
.site-header__inner {
  max-width: calc(var(--max) + 4rem);
  margin: 0 auto;
  padding: 1rem 2rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem 2rem;
  align-items: end;
}
.site-header__brand { min-width: 0; }
.site-header__title { margin: 0; }
.site-header__brand span {
  display: block;
  margin-top: 0.25rem;
  color: var(--muted);
  font-size: 0.92rem;
  max-width: 34rem;
}
.site-header__title a {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.site-header__logo img {
  display: block;
  width: 1.5rem;
  height: 1.5rem;
  object-fit: contain;
}
.site-nav ul {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 1.05rem;
  margin: 0;
  padding: 0;
  align-items: center;
  justify-content: flex-end;
}
.site-nav li {
  display: flex;
  align-items: center;
  margin: 0;
}
.site-nav li + li {
  margin-top: 0;
}
.site-nav {
  min-width: 0;
}
.site-nav a {
  color: var(--muted);
  font-size: 0.94rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  min-height: 2.25rem;
  padding: 0 0.05rem;
  white-space: nowrap;
}
.site-nav a:hover { color: var(--link-hover); }
main {
  max-width: calc(var(--max) + 4rem);
  margin: 0 auto;
  padding: 2rem;
}
.site-languages {
  position: relative;
  display: flex;
  align-items: flex-end;
}
.site-languages__toggle {
  list-style: none;
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2.25rem;
  padding: 0.45rem 0.82rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--muted);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}
.site-languages__toggle::-webkit-details-marker { display: none; }
.site-languages__toggle:hover,
.site-languages__details[open] > .site-languages__toggle { color: var(--text); }
.site-languages__chevron {
  flex: none;
  transition: transform 0.15s ease;
}
.site-languages__details[open] > .site-languages__toggle .site-languages__chevron {
  transform: rotate(180deg);
}
.site-languages__panel {
  position: absolute;
  top: calc(100% + 0.7rem);
  right: 0;
  list-style: none;
  margin: 0;
  padding: 0.4rem;
  min-width: 9rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 95%, white 5%);
  box-shadow: 0 18px 40px rgba(24, 18, 11, 0.14);
  z-index: 2;
}
.site-languages__panel li { display: flex; }
.site-languages__panel a {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 2.25rem;
  padding: 0 0.7rem;
  border-radius: 9px;
  color: var(--muted);
  font-size: 0.88rem;
  white-space: nowrap;
}
.site-languages__panel a:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--border) 26%, transparent);
}
.site-languages__panel a[aria-current='page'] {
  color: var(--text);
  font-weight: 700;
}
.site-footer {
  max-width: calc(var(--max) + 4rem);
  margin: 0 auto;
  padding: 0 2rem 2.5rem;
}
.site-footer__inner {
  border-top: 1px solid var(--border);
  padding-top: 1rem;
  color: var(--muted);
}
.site-footer__meta {
  margin-top: 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.site-footer__actions {
  display: inline-flex;
  align-items: center;
  gap: 0.95rem;
  flex-wrap: wrap;
}
.site-footer__nav ul,
.site-footer__social {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 0;
  padding: 0;
}
.site-footer__nav li,
.site-footer__social li {
  margin: 0;
}
.site-footer__social {
  margin-top: 1rem;
}
.site-footer__social a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  height: 2.1rem;
  color: var(--muted);
}
.site-footer__social svg {
  width: 1rem;
  height: 1rem;
  fill: currentColor;
}
.site-footer__social-label {
  font-size: 0.82rem;
  font-weight: 700;
}
.site-footer__text,
.site-footer__edit-link,
.site-footer__markdown-link {
  display: block;
  margin-top: 0.95rem;
}
.site-footer__edit-link,
.site-footer__markdown-link {
  display: inline-block;
  margin-top: 0;
  font-size: 0.78rem;
  color: var(--muted);
  opacity: 0.72;
}
@media (max-width: 720px) {
  .site-footer__meta {
    flex-direction: column;
    align-items: flex-start;
  }
}
article {
  background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247,250,252,0.98));
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 2.25rem 2.4rem;
  box-shadow: 0 24px 50px rgba(15, 34, 58, 0.08);
}
article > p:first-child {
  margin-top: 0;
  color: var(--muted);
  font-size: 0.88rem;
  font-weight: 600;
}
h1, h2, h3, h4 {
  line-height: 1.08;
  letter-spacing: -0.03em;
  margin: 2rem 0 0.8rem;
  scroll-margin-top: 5rem;
}
h1 { font-size: clamp(2.3rem, 6vw, 3.8rem); margin-top: 0.15rem; }
h2 {
  font-size: 1.45rem;
  padding-top: 0.4rem;
  border-top: 1px solid rgba(215, 225, 236, 0.8);
}
h3 { font-size: 1.1rem; }
p, ul, ol, pre, table, blockquote { margin: 1rem 0; }
ul, ol { padding-left: 1.4rem; }
li + li { margin-top: 0.35rem; }
img { max-width: 100%; height: auto; border-radius: 14px; border: 1px solid var(--border); background: white; }
pre, code { font-family: "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace; }
code {
  background: var(--code-bg);
  color: #183f7a;
  border-radius: 0.35rem;
  padding: 0.16rem 0.38rem;
  font-size: 0.88em;
}
pre {
  background: #0f1722;
  color: #eaf1ff;
  padding: 1rem 1.1rem;
  border-radius: 16px;
  overflow-x: auto;
  border: 1px solid rgba(255,255,255,0.06);
}
pre code { background: transparent; color: inherit; padding: 0; }
blockquote {
  margin-left: 0;
  padding: 0.1rem 0 0.1rem 1rem;
  border-left: 3px solid #9fc1ff;
  color: var(--muted);
}
table { width: 100%; border-collapse: collapse; font-size: 0.94rem; }
th, td { text-align: left; border-bottom: 1px solid var(--border); padding: 0.72rem 0.4rem; }
th { color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; }
hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
.catalog-page {
  margin-top: 2.2rem;
}
.catalog-page__body > :last-child {
  margin-bottom: 0;
}
.catalog-list {
  margin-top: 1rem;
  display: grid;
  gap: 0.95rem;
}
.catalog-item {
  display: block;
  text-decoration: none;
}
.catalog-item__title {
  display: block;
  color: var(--text);
  font-size: 1.08rem;
}
.catalog-item__detail {
  display: block;
  margin-top: 0.4rem;
  color: var(--muted);
  font-size: 0.92rem;
}
.catalog-item {
  padding: 1rem 0 0.1rem;
  border-top: 1px solid rgba(215, 225, 236, 0.8);
}
.catalog-list > .catalog-item:first-child {
  border-top: 0;
  padding-top: 0;
}
.catalog-item:hover {
  text-decoration: none;
}
.catalog-load-more {
  margin-top: 1.2rem;
}
.catalog-load-more__button {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 999px;
  padding: 0.65rem 1rem;
  font: inherit;
  font-size: 0.95rem;
  cursor: pointer;
}
.catalog-load-more__button:hover {
  background: color-mix(in srgb, var(--surface) 75%, var(--accent) 25%);
}
.catalog-load-more__button:disabled {
  cursor: wait;
  opacity: 0.7;
}
@media (max-width: 720px) {
  .site-header__inner, main, .site-footer { padding-left: 1rem; padding-right: 1rem; }
  .site-header__inner {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 0.5rem;
  }
  .site-nav {
    margin-top: 0.2rem;
    padding-top: 0.8rem;
    border-top: 1px solid rgba(215, 225, 236, 0.88);
  }
  .site-nav ul { justify-content: flex-start; }
  article { padding: 1.3rem; border-radius: 18px; }
}
`.trim();
}
