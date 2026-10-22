import matter from 'gray-matter';
import yaml from 'js-yaml';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

import type { ContentEntry } from './content-store.js';
import { normalizeContentDate, normalizePageRobots, type PageRobots } from './seo.js';

export interface ParsedDocumentMeta {
  title?: string;
  name?: string;
  date?: string;
  updated?: string;
  author?: string | string[];
  robots?: PageRobots;
  /** Independent of external search indexing; false excludes this document from site search. */
  search?: boolean;
  summary?: string;
  description?: string;
  draft?: boolean;
  type?: string;
  order?: number;
  aliases?: string[];
  /**
   * Canonical social sharing image for this document, normalized from the
   * `socialImage` frontmatter field, with `image` and `cover` accepted as
   * aliases. Consumers should read this field instead of the raw alias fields.
   */
  socialImage?: string;
  [key: string]: unknown;
}

export interface ManagedIndexEntry {
  kind: 'directory' | 'article';
  title: string;
  href: string;
  detail?: string;
}

/**
 * Parsed document without rendered HTML. Extracting frontmatter metadata is
 * orders of magnitude cheaper than rendering markdown to HTML, so metadata
 * consumers (listings, sitemaps, feeds, alias scans) use this shape.
 */
export interface ParsedDocumentLite {
  sourcePath: string;
  body: string;
  meta: ParsedDocumentMeta;
}

export interface ParsedDocument extends ParsedDocumentLite {
  html: string;
}

export interface MarkdownHeading {
  id: string;
  text: string;
  depth: number;
  /** Offset in the exact Markdown string passed to the renderer. */
  charStart: number;
}

interface HtmlNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
  position?: { start?: { offset?: number } };
}

export function getDocumentTitle(meta: ParsedDocumentMeta, body: string, fallback: string): string {
  return (
    firstNonEmptyString(meta.title, meta.name) ??
    extractFirstHeading(body) ??
    fallback
  );
}

export function getDocumentSummary(
  meta: ParsedDocumentMeta,
  body: string,
): string | undefined {
  return (
    firstNonEmptyString(meta.summary, meta.description) ??
    extractFirstParagraph(body)
  );
}

export async function parseMarkdownDocument(
  sourcePath: string,
  markdown: string,
): Promise<ParsedDocument> {
  const { body, meta } = parseDocumentMeta(sourcePath, markdown);
  const html = rewriteMarkdownLinksInHtml(await renderMarkdown(body));

  return {
    sourcePath,
    body,
    html,
    meta,
  };
}

export function parseDocumentMeta(
  sourcePath: string,
  markdown: string,
): ParsedDocumentLite {
  const parsed = matter(markdown, {
    engines: {
      yaml: (source: string) => yaml.safeLoad(source, { schema: FRONTMATTER_SCHEMA }) as object,
    },
  });

  return {
    sourcePath,
    body: parsed.content,
    meta: normalizeMeta(parsed.data),
  };
}

const entryDocumentMetaCache = new WeakMap<ContentEntry, ParsedDocumentLite>();

/**
 * Parse a store entry's frontmatter metadata, memoized by entry identity.
 * Immutable in-memory stores return the same entry object per path, so
 * repeated metadata reads (alias scans, listings, feeds) parse each document
 * at most once per isolate. File-system stores return fresh entry objects,
 * which naturally bypasses the cache after content edits.
 */
export function parseEntryDocumentMeta(entry: ContentEntry): ParsedDocumentLite {
  const cached = entryDocumentMetaCache.get(entry);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = parseDocumentMeta(entry.path, entry.text ?? '');
  entryDocumentMetaCache.set(entry, parsed);
  return parsed;
}

export async function renderMarkdown(markdown: string): Promise<string> {
  return (await renderMarkdownWithHeadings(markdown)).html;
}

export async function renderMarkdownWithHeadings(
  markdown: string,
): Promise<{ html: string; headings: MarkdownHeading[] }> {
  const headings: MarkdownHeading[] = [];
  const output = await remark()
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(() => (tree: unknown) => assignHeadingIds(tree as HtmlNode, headings))
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return { html: String(output), headings };
}

function assignHeadingIds(root: HtmlNode, headings: MarkdownHeading[]): void {
  const reserved = new Set<string>();
  const seen = new Set<string>();
  const visit = (node: HtmlNode, callback: (node: HtmlNode) => void) => {
    callback(node);
    for (const child of node.children ?? []) visit(child, callback);
  };
  visit(root, (node) => {
    if (typeof node.properties?.id === 'string') reserved.add(node.properties.id);
  });
  const unique = (base: string) => {
    let id = base;
    let suffix = 0;
    while (reserved.has(id)) id = `${base}-${++suffix}`;
    reserved.add(id);
    return id;
  };
  const text = (node: HtmlNode): string =>
    node.type === 'comment' ? '' :
      node.value ?? (node.tagName === 'img' ? String(node.properties?.alt ?? '') : (node.children ?? []).map(text).join(''));
  visit(root, (node) => {
    let id = typeof node.properties?.id === 'string' ? node.properties.id : undefined;
    if (id !== undefined) {
      if (seen.has(id)) {
        id = unique(id);
        node.properties!.id = id;
      }
      seen.add(id);
    }
    if (!/^h[1-6]$/.test(node.tagName ?? '')) return;
    const label = text(node);
    if (!id) {
      const slug = label.normalize('NFKC').toLowerCase().trim()
        .replace(/\s+/g, '-').replace(/[^\p{L}\p{N}\p{M}_-]/gu, '') || 'section';
      id = unique(slug);
      node.properties = { ...node.properties, id };
    }
    const offset = node.position?.start?.offset;
    if (typeof offset === 'number') {
      headings.push({ id, text: label, depth: Number(node.tagName![1]), charStart: offset });
    }
  });
}

export function rewriteMarkdownLinksInHtml(html: string): string {
  return html.replaceAll(
    /(<a\b[^>]*?\shref=")([^"]+)(")/g,
    (_match, prefix: string, href: string, suffix: string) =>
      `${prefix}${rewriteMarkdownHref(href)}${suffix}`,
  );
}

export function stripManagedIndexBlock(markdown: string): string {
  return markdown.replace(
    /\n?<!-- INDEX:START -->[\s\S]*?<!-- INDEX:END -->\n?/g,
    '\n',
  ).trimEnd();
}

export function stripMachineOnlyMarkdownComments(markdown: string): string {
  return markdown.replace(/<!--\s*mdorigin:[\s\S]*?-->/g, '');
}

export function stripManagedIndexLinks(
  markdown: string,
  hrefs: ReadonlySet<string>,
): string {
  if (hrefs.size === 0) {
    return markdown;
  }

  return markdown.replace(
    /(\n<!-- INDEX:START -->\n)([\s\S]*?)(\n<!-- INDEX:END -->)/,
    (_match, start: string, content: string, end: string) => {
      const blocks = content
        .trim()
        .split(/\n\s*\n/g)
        .map((block) => block.trim())
        .filter((block) => block !== '');

      const keptBlocks = blocks.filter((block) => {
        const firstLine = block.split('\n', 1)[0] ?? '';
        const hrefMatch = firstLine.match(/\[[^\]]+\]\(([^)]+)\)/);
        if (!hrefMatch) {
          return true;
        }

        return !hrefs.has(normalizeManagedIndexHref(hrefMatch[1]));
      });

      if (keptBlocks.length === 0) {
        return `${start.trimEnd()}\n\n${end.trimStart()}`;
      }

      return `${start}${keptBlocks.join('\n\n')}\n${end}`;
    },
  );
}

export function extractManagedIndexEntries(markdown: string): ManagedIndexEntry[] {
  const match = markdown.match(/<!-- INDEX:START -->\n?([\s\S]*?)\n?<!-- INDEX:END -->/);
  if (!match) {
    return [];
  }

  const blocks = match[1]
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter((block) => block !== '');

  const entries: ManagedIndexEntry[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const firstLine = lines[0]?.trim() ?? '';
    const entryMatch = firstLine.match(/^- \[([^\]]+)\]\(([^)]+)\)$/);
    if (!entryMatch) {
      continue;
    }

    const rawHref = entryMatch[2];
    const href = rewriteMarkdownHref(rawHref);
    const explicitKind = extractManagedIndexKind(lines.slice(1));
    entries.push({
      kind: explicitKind ?? (href.endsWith('/') ? 'directory' : 'article'),
      title: entryMatch[1],
      href,
      detail: extractManagedIndexDetail(lines.slice(1)),
    });
  }

  return entries;
}

function extractManagedIndexKind(
  lines: readonly string[],
): ManagedIndexEntry['kind'] | undefined {
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^<!--\s*mdorigin:index\s+kind=(article|directory)\s*-->$/);
    if (match) {
      return match[1] as ManagedIndexEntry['kind'];
    }
  }

  return undefined;
}

function extractManagedIndexDetail(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }

    if (/^<!--\s*mdorigin:index\s+kind=(article|directory)\s*-->$/.test(trimmed)) {
      continue;
    }

    return trimmed;
  }

  return undefined;
}

// Preserve YAML timestamp spelling until our calendar/timezone validator runs.
// The default YAML Date constructor silently rolls e.g. February 30 into March.
const RAW_TIMESTAMP = new yaml.Type('tag:yaml.org,2002:timestamp', {
  kind: 'scalar',
  resolve: (value: string) => /^\d{4}-\d{1,2}-\d{1,2}(?:$|[Tt\s])/.test(value),
  construct: (value: string) => value,
});
const FRONTMATTER_SCHEMA = new yaml.Schema({
  include: [yaml.DEFAULT_SAFE_SCHEMA],
  implicit: [RAW_TIMESTAMP],
  explicit: [RAW_TIMESTAMP],
});

function normalizeMeta(data: Record<string, unknown>): ParsedDocumentMeta {
  const meta: ParsedDocumentMeta = { ...data };

  if (typeof data.title === 'string') {
    meta.title = data.title;
  }

  if (typeof data.name === 'string') {
    meta.name = data.name;
  }

  for (const key of ['date', 'updated'] as const) {
    const normalized = normalizeContentDate(data[key]);
    if (normalized === undefined) delete meta[key];
    else meta[key] = normalized;
  }
  meta.robots = normalizePageRobots(data.robots);
  if (data.noindex === true) meta.robots = { ...meta.robots, index: false };
  if (typeof data.author === 'string' && data.author.trim()) meta.author = data.author.trim();
  else if (Array.isArray(data.author)) meta.author = data.author.filter(
    (author): author is string => typeof author === 'string' && author.trim().length > 0,
  ).map((author) => author.trim());
  else delete meta.author;
  if (typeof data.search !== 'boolean') delete meta.search;

  if (typeof data.summary === 'string') {
    meta.summary = data.summary;
  }

  if (typeof data.description === 'string') {
    meta.description = data.description;
  }

  if (typeof data.draft === 'boolean') {
    meta.draft = data.draft;
  }

  if (typeof data.type === 'string') {
    meta.type = data.type;
  }

  if (typeof data.order === 'number' && Number.isFinite(data.order)) {
    meta.order = data.order;
  }

  if (typeof data.order === 'string') {
    const order = Number.parseInt(data.order, 10);
    if (Number.isFinite(order)) {
      meta.order = order;
    }
  }

  if (typeof data.aliases === 'string' && data.aliases !== '') {
    meta.aliases = [data.aliases];
  }

  if (Array.isArray(data.aliases)) {
    meta.aliases = data.aliases.filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
  }

  const socialImage = firstNonEmptyString(data.socialImage, data.image, data.cover);
  if (socialImage !== undefined) {
    meta.socialImage = socialImage;
  } else {
    delete meta.socialImage;
  }

  return meta;
}

function rewriteMarkdownHref(href: string): string {
  if (shouldPreserveHref(href)) {
    return href;
  }

  const [pathPart, hashPart] = splitOnce(href, '#');
  const [pathname, queryPart] = splitOnce(pathPart, '?');

  if (!pathname.toLowerCase().endsWith('.md')) {
    return href;
  }

  const normalizedPath = pathname.replace(/\\/g, '/');
  const rewrittenPath = rewriteMarkdownPath(normalizedPath);
  const querySuffix = queryPart !== undefined ? `?${queryPart}` : '';
  const hashSuffix = hashPart !== undefined ? `#${hashPart}` : '';
  return `${rewrittenPath}${querySuffix}${hashSuffix}`;
}

function rewriteMarkdownPath(pathname: string): string {
  if (pathname.toLowerCase().endsWith('/index.md')) {
    return pathname.slice(0, -'index.md'.length);
  }

  if (pathname.toLowerCase() === 'index.md') {
    return './';
  }

  if (pathname.toLowerCase().endsWith('/readme.md')) {
    return pathname.slice(0, -'README.md'.length);
  }

  if (pathname.toLowerCase() === 'readme.md') {
    return './';
  }

  if (pathname.toLowerCase().endsWith('/skill.md')) {
    return pathname.slice(0, -'SKILL.md'.length);
  }

  if (pathname.toLowerCase() === 'skill.md') {
    return './';
  }

  return pathname.slice(0, -'.md'.length);
}

function shouldPreserveHref(href: string): boolean {
  return (
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('//') ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)
  );
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  if (index === -1) {
    return [value, undefined];
  }

  return [value.slice(0, index), value.slice(index + separator.length)];
}

function normalizeManagedIndexHref(href: string): string {
  if (href === './') {
    return '/';
  }

  if (href.startsWith('./')) {
    return `/${href.slice(2)}`;
  }

  return href;
}

function extractFirstHeading(markdown: string): string | undefined {
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) {
      continue;
    }

    const heading = trimmed.replace(/^#+\s*/, '').trim();
    if (heading !== '') {
      return heading;
    }
  }

  return undefined;
}

function extractFirstParagraph(markdown: string): string | undefined {
  const paragraphs = markdown
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');

  for (const paragraph of paragraphs) {
    if (
      paragraph.startsWith('#') ||
      paragraph.startsWith('<!--') ||
      paragraph.startsWith('- ') ||
      paragraph.startsWith('* ')
    ) {
      continue;
    }

    return paragraph.replace(/\s+/g, ' ');
  }

  return undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value !== '');
}
