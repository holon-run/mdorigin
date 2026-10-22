import { normalizeContentPath, type ContentEntry, type ContentStore } from './content-store.js';
import { isCanonicalContentSource } from './directory-index.js';
import { parseEntryDocumentMeta, renderMarkdownWithHeadings, stripManagedIndexBlock, stripMachineOnlyMarkdownComments } from './markdown.js';
import type { SearchHit } from '../search.js';

export function getSearchableMarkdownBody(body: string): string {
  return stripMachineOnlyMarkdownComments(stripManagedIndexBlock(body)).trim();
}

export async function getSearchContentRevision(content: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const citationCache = new WeakMap<ContentEntry, Promise<{
  content: string;
  revision: string;
  headings: Array<{ id: string; byteStart: number }>;
}>>();

/**
 * indexbind 0.6.x calls these fields charStart/charEnd, but uses UTF-8 byte
 * offsets into the transformed search content, not JS string or raw-file offsets.
 * Never guess a fragment from headingPath or publish a stale/ambiguous mapping.
 */
export async function resolveSearchCitation(
  store: ContentStore,
  hit: SearchHit,
  draftMode: 'include' | 'exclude',
): Promise<string | undefined> {
  if (!hit.canonicalUrl || typeof hit.metadata.contentRevision !== 'string') return undefined;
  const sourcePath = normalizeContentPath(hit.relativePath);
  if (sourcePath === null || !sourcePath.endsWith('.md')) return undefined;
  const entry = await store.get(sourcePath);
  if (!entry || entry.kind !== 'text' || entry.text === undefined) return undefined;
  const directoryPath = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
  const entries = await store.listDirectory(directoryPath);
  if (!isCanonicalContentSource(sourcePath, new Set(entries?.map((item) => item.path)))) return undefined;
  const parsed = parseEntryDocumentMeta(entry);
  if (parsed.meta.draft && draftMode === 'exclude') return undefined;
  let pending = citationCache.get(entry);
  if (!pending) {
    pending = (async () => {
      const content = getSearchableMarkdownBody(parsed.body);
      const { headings } = await renderMarkdownWithHeadings(content);
      return {
        content,
        revision: await getSearchContentRevision(content),
        headings: headings.map((heading) => ({
          id: heading.id,
          byteStart: new TextEncoder().encode(content.slice(0, heading.charStart)).byteLength,
        })),
      };
    })();
    citationCache.set(entry, pending);
  }
  const current = await pending;
  if (current.revision !== hit.metadata.contentRevision) return undefined;
  // Upstream may locate repeated blocks with string.find(first occurrence).
  // Only emit precise references when the excerpt's first block is unambiguous.
  const prefix = Array.from(hit.bestMatch.excerpt.split(/\n\s*\n/)[0] ?? '').slice(0, 120).join('');
  if (!prefix) return undefined;
  const start = current.content.indexOf(prefix);
  if (start < 0 || current.content.indexOf(prefix, start + 1) >= 0) return undefined;
  const byteStart = new TextEncoder().encode(current.content.slice(0, start)).byteLength;
  if (byteStart !== hit.bestMatch.charStart) return undefined;
  const heading = current.headings.filter((item) => item.byteStart <= byteStart).at(-1);
  return heading ? `${hit.canonicalUrl.split('#')[0]}#${encodeURIComponent(heading.id)}` : undefined;
}
