import matter from 'gray-matter';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

import type { ContentEntry } from './content-store.js';

export interface ParsedDocumentMeta {
  title?: string;
  name?: string;
  date?: string;
  summary?: string;
  description?: string;
  draft?: boolean;
  type?: string;
  order?: number;
  aliases?: string[];
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
  const parsed = matter(markdown);

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
  const output = await remark()
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return String(output);
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

function normalizeMeta(data: Record<string, unknown>): ParsedDocumentMeta {
  const meta: ParsedDocumentMeta = { ...data };

  if (typeof data.title === 'string') {
    meta.title = data.title;
  }

  if (typeof data.name === 'string') {
    meta.name = data.name;
  }

  if (typeof data.date === 'string') {
    meta.date = data.date;
  }

  if (data.date instanceof Date && !Number.isNaN(data.date.getTime())) {
    meta.date = data.date.toISOString().slice(0, 10);
  }

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

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value !== '');
}
