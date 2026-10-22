import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { inferDirectoryContentType } from './core/content-type.js';
import { getDirectoryIndexCandidates, isCanonicalContentSource } from './core/directory-index.js';
import {
  getDocumentSummary,
  getDocumentTitle,
  parseMarkdownDocument,
} from './core/markdown.js';
import { getSearchableMarkdownBody, getSearchContentRevision } from './core/search-citations.js';
import type { ParsedDocumentMeta } from './core/markdown.js';
import { isIgnoredContentName } from './core/content-store.js';
import { ensureTrailingSlash, trimLeadingSlash } from './core/site-url.js';
import type {
  ResolvedSiteConfig,
  SiteSearchConfig,
  SiteSearchPolicyOverrideConfig,
  SiteSearchRerankerConfig,
  SiteSearchScoreAdjustmentConfig,
} from './core/site-config.js';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface IndexbindBuildDocument {
  docId?: string;
  sourcePath?: string;
  relativePath: string;
  canonicalUrl?: string;
  title?: string;
  summary?: string;
  content: string;
  metadata?: Record<string, JsonValue>;
}

interface IndexbindBuildModule {
  buildCanonicalBundle(
    outputDir: string,
    documents: IndexbindBuildDocument[],
    options?: {
      embeddingBackend?: 'hashing' | 'model2vec';
      hashingDimensions?: number;
      model?: string;
      batchSize?: number;
      sourceRootId?: string;
      sourceRootPath?: string;
      targetTokens?: number;
      overlapTokens?: number;
    },
  ): Promise<{ documentCount: number; chunkCount: number; vectorDimensions: number }>;
  updateBuildCache(
    cachePath: string,
    documents: IndexbindBuildDocument[],
    options?: {
      embeddingBackend?: 'hashing' | 'model2vec';
      hashingDimensions?: number;
      model?: string;
      batchSize?: number;
      sourceRootId?: string;
      sourceRootPath?: string;
      targetTokens?: number;
      overlapTokens?: number;
    },
    removedRelativePaths?: string[],
  ): Promise<{
    scannedDocumentCount: number;
    newDocumentCount: number;
    changedDocumentCount: number;
    unchangedDocumentCount: number;
    removedDocumentCount: number;
    activeDocumentCount: number;
    activeChunkCount: number;
  }>;
  exportCanonicalBundleFromBuildCache(
    cachePath: string,
    outputDir: string,
  ): Promise<{ documentCount: number; chunkCount: number; vectorDimensions: number }>;
}

export interface SearchHit {
  docId: string;
  relativePath: string;
  canonicalUrl?: string;
  title?: string;
  summary?: string;
  metadata: Record<string, JsonValue>;
  score: number;
  bestMatch: {
    chunkId: number;
    excerpt: string;
    headingPath: string[];
    charStart: number;
    charEnd: number;
    score: number;
  };
}

interface IndexbindWebIndex {
  search(
    query: string,
    options?: {
      topK?: number;
      mode?: 'hybrid' | 'vector';
      minScore?: number;
      reranker?: SiteSearchRerankerConfig;
      relativePathPrefix?: string;
      metadata?: Record<string, JsonValue>;
      scoreAdjustment?: SiteSearchScoreAdjustmentConfig;
    },
  ): Promise<SearchHit[]>;
}

interface IndexbindOpenWebIndexOptions {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface IndexbindWebModule {
  openWebIndex(
    base: string | URL,
    options?: IndexbindOpenWebIndexOptions,
  ): Promise<IndexbindWebIndex>;
}

interface IndexbindCloudflareModule {
  openWebIndex(
    base: string | URL,
    options?: IndexbindOpenWebIndexOptions,
  ): Promise<IndexbindWebIndex>;
}

export interface SearchQueryOptions {
  topK?: number;
  mode?: 'hybrid' | 'vector';
  minScore?: number;
  reranker?: SiteSearchRerankerConfig;
  relativePathPrefix?: string;
  metadata?: Record<string, string>;
  scoreAdjustment?: SiteSearchScoreAdjustmentConfig;
}

export interface SearchApi {
  search(
    query: string,
    options?: SearchQueryOptions,
  ): Promise<SearchHit[]>;
}

export interface SearchBundleEntry {
  path: string;
  kind: 'text' | 'binary';
  mediaType: string;
  text?: string;
  base64?: string;
}

export interface ExternalSearchBundleEntry {
  path: string;
  mediaType: string;
  storageKind: 'assets' | 'r2';
  storageKey: string;
  byteSize: number;
}

interface SearchDocument {
  absolutePath: string;
  relativePath: string;
}

interface SearchBundleManifest {
  files?: {
    documents?: string;
  };
}

interface SearchBundleDocument {
  docId: string;
  canonicalUrl?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata?: Record<string, JsonValue>;
}

const OVERVIEW_CONTENT_FILENAMES = new Set(['readme.md', 'index.md', 'skill.md']);

export interface BuildSearchBundleOptions {
  rootDir: string;
  outDir: string;
  siteConfig: ResolvedSiteConfig;
  draftMode?: 'include' | 'exclude';
  embeddingBackend?: 'hashing' | 'model2vec';
  model?: string;
  incremental?: boolean;
  cachePath?: string;
}

export interface BuildSearchBundleResult {
  outputDir: string;
  documentCount: number;
  chunkCount: number;
  vectorDimensions: number;
  cachePath?: string;
  incremental?: {
    scannedDocumentCount: number;
    newDocumentCount: number;
    changedDocumentCount: number;
    unchangedDocumentCount: number;
    removedDocumentCount: number;
    activeDocumentCount: number;
    activeChunkCount: number;
  };
}

export interface SearchBundleOptions {
  indexDir: string;
  query: string;
  topK?: number;
  mode?: 'hybrid' | 'vector';
  minScore?: number;
  reranker?: SiteSearchRerankerConfig;
  relativePathPrefix?: string;
  metadata?: Record<string, string>;
  scoreAdjustment?: SiteSearchScoreAdjustmentConfig;
}

export async function buildSearchBundle(
  options: BuildSearchBundleOptions,
): Promise<BuildSearchBundleResult> {
  const buildModule = await loadIndexbindBuildModule();
  const rootDir = path.resolve(options.rootDir);
  const outputDir = path.resolve(options.outDir);
  const documents = await collectSearchDocuments(rootDir, options.siteConfig, {
    draftMode: options.draftMode ?? 'exclude',
  });
  const buildOptions = {
    embeddingBackend: options.embeddingBackend ?? 'model2vec',
    model: options.model,
    sourceRootId: path.basename(rootDir),
    sourceRootPath: rootDir,
  } as const;

  if (options.incremental) {
    const cachePath = path.resolve(
      options.cachePath ?? defaultSearchBuildCachePath(outputDir),
    );
    await mkdir(path.dirname(cachePath), { recursive: true });
    const removedRelativePaths = await resolveRemovedRelativePaths(
      cachePath,
      documents.map((document) => document.relativePath),
    );
    const incrementalStats = await buildModule.updateBuildCache(
      cachePath,
      documents,
      buildOptions,
      removedRelativePaths,
    );
    const stats = await buildModule.exportCanonicalBundleFromBuildCache(
      cachePath,
      outputDir,
    );
    await writeSearchBuildState(cachePath, documents.map((document) => document.relativePath));

    return {
      outputDir,
      documentCount: stats.documentCount,
      chunkCount: stats.chunkCount,
      vectorDimensions: stats.vectorDimensions,
      cachePath,
      incremental: incrementalStats,
    };
  }

  const stats = await buildModule.buildCanonicalBundle(
    outputDir,
    documents,
    buildOptions,
  );

  return {
    outputDir,
    documentCount: stats.documentCount,
    chunkCount: stats.chunkCount,
    vectorDimensions: stats.vectorDimensions,
  };
}

export async function searchBundle(
  options: SearchBundleOptions,
): Promise<SearchHit[]> {
  const searchContext = await openSearchContextFromDirectory(path.resolve(options.indexDir));
  return rerankSearchHits(
    hydrateSearchHits(
      await searchContext.index.search(
      options.query,
      buildIndexbindSearchOptions({
        topK: options.topK ?? 10,
        mode: options.mode,
        minScore: options.minScore,
        reranker: options.reranker,
        relativePathPrefix: options.relativePathPrefix,
        metadata: options.metadata,
        scoreAdjustment: options.scoreAdjustment,
      }),
      ),
      searchContext.documentsById,
    ),
  );
}

export async function createSearchApiFromDirectory(
  indexDir: string,
  defaults?: SiteSearchConfig,
): Promise<SearchApi> {
  const searchContext = await openSearchContextFromDirectory(path.resolve(indexDir));
  return {
    async search(query, options) {
      const searchOptions = resolveSearchQueryOptions(query, defaults, options);
      return rerankSearchHits(
        hydrateSearchHits(
          await searchContext.index.search(
            query,
            buildIndexbindSearchOptions(searchOptions),
          ),
          searchContext.documentsById,
        ),
      );
    },
  };
}

export function createSearchApiFromBundle(
  bundleEntries: SearchBundleEntry[],
  defaults?: SiteSearchConfig,
): SearchApi {
  let searchContextPromise: Promise<{
    index: IndexbindWebIndex;
    documentsById: Map<string, SearchBundleDocument>;
  }> | null = null;

  return {
    async search(query, options) {
      if (searchContextPromise === null) {
        searchContextPromise = openSearchContextFromBundle(
          bundleEntries,
          async (entry) => createInlineSearchBundleResponse(entry),
        );
      }

      const searchContext = await searchContextPromise;
      const searchOptions = resolveSearchQueryOptions(query, defaults, options);
      return rerankSearchHits(
        hydrateSearchHits(
          await searchContext.index.search(
            query,
            buildIndexbindSearchOptions(searchOptions),
          ),
          searchContext.documentsById,
        ),
      );
    },
  };
}

export function createSearchApiFromExternalBundle(
  bundleEntries: ExternalSearchBundleEntry[],
  loadResponse: (entry: ExternalSearchBundleEntry) => Promise<Response>,
  defaults?: SiteSearchConfig,
): SearchApi {
  let searchContextPromise: Promise<{
    index: IndexbindWebIndex;
    documentsById: Map<string, SearchBundleDocument>;
  }> | null = null;

  return {
    async search(query, options) {
      if (searchContextPromise === null) {
        searchContextPromise = openSearchContextFromBundle(bundleEntries, loadResponse);
      }

      const searchContext = await searchContextPromise;
      const searchOptions = resolveSearchQueryOptions(query, defaults, options);
      return rerankSearchHits(
        hydrateSearchHits(
          await searchContext.index.search(
            query,
            buildIndexbindSearchOptions(searchOptions),
          ),
          searchContext.documentsById,
        ),
      );
    },
  };
}

async function collectSearchDocuments(
  rootDir: string,
  siteConfig: ResolvedSiteConfig,
  options: { draftMode: 'include' | 'exclude' },
): Promise<IndexbindBuildDocument[]> {
  const searchDocuments = await listSearchDocuments(rootDir);
  const documents: IndexbindBuildDocument[] = [];
  const availablePaths = new Set(searchDocuments.map((document) => document.relativePath));

  for (const document of searchDocuments) {
    if (!isCanonicalContentSource(document.relativePath, availablePaths)) continue;
    const markdown = await readFile(document.absolutePath, 'utf8');
    const parsed = await parseMarkdownDocument(document.relativePath, markdown);
    if ((parsed.meta.draft === true && options.draftMode === 'exclude') || parsed.meta.search === false) {
      continue;
    }

    const canonicalPath = getCanonicalHtmlPathForContentPath(document.relativePath);
    const absoluteCanonicalUrl = siteConfig.siteUrl
      ? new URL(trimLeadingSlash(canonicalPath), ensureTrailingSlash(siteConfig.siteUrl)).toString()
      : canonicalPath;
    const content = getSearchableMarkdownBody(parsed.body);
    documents.push({
      docId: canonicalPath,
      sourcePath: document.absolutePath,
      relativePath: document.relativePath,
      canonicalUrl: absoluteCanonicalUrl,
      title: getDocumentTitle(
        parsed.meta,
        parsed.body,
        fallbackTitleFromRelativePath(document.relativePath),
      ),
      summary: getDocumentSummary(parsed.meta, parsed.body),
      content,
      metadata: {
        ...buildSearchMetadata(document.relativePath, canonicalPath, parsed.meta, siteConfig),
        contentRevision: await getSearchContentRevision(content),
      },
    });
  }

  return documents;
}

async function listSearchDocuments(rootDir: string): Promise<SearchDocument[]> {
  const results: SearchDocument[] = [];
  await walkDirectory(rootDir, '', new Set<string>(), results);
  results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return results;
}

async function walkDirectory(
  absoluteDirectoryPath: string,
  relativeDirectoryPath: string,
  visitedRealDirectories: Set<string>,
  results: SearchDocument[],
): Promise<void> {
  const realDirectoryPath = await realpath(absoluteDirectoryPath);
  if (visitedRealDirectories.has(realDirectoryPath)) {
    return;
  }
  visitedRealDirectories.add(realDirectoryPath);

  const entries = await readdir(absoluteDirectoryPath, { withFileTypes: true });
  const shape = await inspectDirectoryShape(absoluteDirectoryPath);
  const indexFile = await resolveVisibleDirectoryIndexFile(
    absoluteDirectoryPath,
    relativeDirectoryPath,
  );

  if (indexFile) {
    results.push(indexFile);
  }

  for (const entry of entries) {
    if (isIgnoredContentName(entry.name)) {
      continue;
    }

    const absoluteEntryPath = path.join(absoluteDirectoryPath, entry.name);
    const entryStats = await stat(absoluteEntryPath);
    const relativeEntryPath =
      relativeDirectoryPath === ''
        ? entry.name
        : path.posix.join(relativeDirectoryPath, entry.name);

    if (entryStats.isFile()) {
      if (path.posix.extname(entry.name).toLowerCase() !== '.md') {
        continue;
      }

      if (DIRECTORY_INDEX_FILENAMES_LOWER.has(entry.name.toLowerCase())) {
        continue;
      }

      results.push({
        absolutePath: absoluteEntryPath,
        relativePath: relativeEntryPath,
      });
      continue;
    }

    if (!entryStats.isDirectory()) {
      continue;
    }

    if (shape.hasSkillIndex && isIgnoredSkillSupportDirectory(entry.name)) {
      continue;
    }

    if (indexFile) {
      const source = await readFile(indexFile.absolutePath, 'utf8');
      const parsed = await parseMarkdownDocument(indexFile.relativePath, source);
      if (inferDirectoryContentType(parsed.meta, shape) === 'post') {
        continue;
      }
    }

    await walkDirectory(
      absoluteEntryPath,
      relativeEntryPath,
      visitedRealDirectories,
      results,
    );
  }
}

async function resolveVisibleDirectoryIndexFile(
  absoluteDirectoryPath: string,
  relativeDirectoryPath: string,
): Promise<SearchDocument | null> {
  for (const candidate of getDirectoryIndexCandidates('')) {
    const absoluteCandidatePath = path.join(absoluteDirectoryPath, candidate);
    if (await pathExists(absoluteCandidatePath)) {
      return {
        absolutePath: absoluteCandidatePath,
        relativePath:
          relativeDirectoryPath === ''
            ? candidate
            : path.posix.join(relativeDirectoryPath, candidate),
      };
    }
  }

  return null;
}

async function inspectDirectoryShape(directoryPath: string): Promise<{
  hasSkillIndex: boolean;
  hasChildDirectories: boolean;
  hasExtraMarkdownFiles: boolean;
  hasAssetFiles: boolean;
}> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  let hasSkillIndex = false;
  let hasChildDirectories = false;
  let hasExtraMarkdownFiles = false;
  let hasAssetFiles = false;

  for (const entry of entries) {
    if (isIgnoredContentName(entry.name)) {
      continue;
    }

    const absoluteEntryPath = path.join(directoryPath, entry.name);
    const entryStats = await stat(absoluteEntryPath);

    if (entryStats.isDirectory()) {
      hasChildDirectories = true;
      continue;
    }

    if (!entryStats.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (extension === '.md') {
      if (entry.name === 'SKILL.md') {
        hasSkillIndex = true;
      } else if (entry.name !== 'index.md' && entry.name !== 'README.md') {
        hasExtraMarkdownFiles = true;
      }
      continue;
    }

    hasAssetFiles = true;
  }

  return {
    hasSkillIndex,
    hasChildDirectories,
    hasExtraMarkdownFiles,
    hasAssetFiles,
  };
}

function buildSearchMetadata(
  relativePath: string,
  canonicalPath: string,
  meta: ParsedDocumentMeta,
  siteConfig: ResolvedSiteConfig,
): Record<string, JsonValue> {
  const metadata: Record<string, JsonValue> = {
    markdownPath: `/${relativePath}`,
    canonicalPath,
    siteTitle: siteConfig.siteTitle,
    section: getSearchSection(relativePath),
    isOverview: isOverviewContentPath(relativePath),
  };

  if (meta.type === 'page' || meta.type === 'post') {
    metadata.type = meta.type;
  }

  if (typeof meta.date === 'string') {
    metadata.date = meta.date;
  }
  if (meta.updated) metadata.updated = meta.updated;
  if (meta.author) metadata.author = meta.author;

  if (typeof meta.order === 'number') {
    metadata.order = meta.order;
  }

  if (Array.isArray(meta.aliases)) {
    metadata.aliases = meta.aliases;
  }

  return metadata;
}

function getSearchSection(relativePath: string): string {
  const directory = path.posix.dirname(relativePath.replaceAll('\\', '/'));
  if (directory === '.') {
    return '';
  }

  const [firstSegment] = directory.split('/', 1);
  return firstSegment ?? '';
}

function isOverviewContentPath(relativePath: string): boolean {
  return OVERVIEW_CONTENT_FILENAMES.has(
    path.posix.basename(relativePath).toLowerCase(),
  );
}

function fallbackTitleFromRelativePath(relativePath: string): string {
  const baseName = path.posix.basename(relativePath);
  if (DIRECTORY_INDEX_FILENAMES_LOWER.has(baseName.toLowerCase())) {
    return path.posix.basename(path.posix.dirname(relativePath));
  }

  return baseName.replace(/\.md$/i, '');
}

function getCanonicalHtmlPathForContentPath(contentPath: string): string {
  const basename = path.posix.basename(contentPath).toLowerCase();
  if (
    basename === 'index.md' ||
    basename === 'readme.md' ||
    basename === 'skill.md'
  ) {
    const directory = path.posix.dirname(contentPath);
    return directory === '.' ? '/' : `/${directory}/`;
  }

  return `/${contentPath.slice(0, -'.md'.length)}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }

    throw error;
  }
}

function defaultSearchBuildCachePath(outputDir: string): string {
  return path.join(
    path.dirname(outputDir),
    `${path.basename(outputDir)}.indexbind-cache.sqlite`,
  );
}

function getSearchBuildStatePath(cachePath: string): string {
  return `${cachePath}.state.json`;
}

async function resolveRemovedRelativePaths(
  cachePath: string,
  currentRelativePaths: readonly string[],
): Promise<string[]> {
  const previousRelativePaths = await readSearchBuildState(cachePath);
  const current = new Set(currentRelativePaths);
  return previousRelativePaths.filter((relativePath) => !current.has(relativePath));
}

async function readSearchBuildState(cachePath: string): Promise<string[]> {
  const statePath = getSearchBuildStatePath(cachePath);
  if (!(await pathExists(statePath))) {
    return [];
  }

  const parsed = JSON.parse(await readFile(statePath, 'utf8')) as {
    relativePaths?: string[];
  };
  return Array.isArray(parsed.relativePaths)
    ? parsed.relativePaths.filter((value): value is string => typeof value === 'string')
    : [];
}

async function writeSearchBuildState(
  cachePath: string,
  relativePaths: readonly string[],
): Promise<void> {
  await writeFile(
    getSearchBuildStatePath(cachePath),
    JSON.stringify(
      {
        version: 1,
        relativePaths: [...relativePaths].sort((left, right) =>
          left.localeCompare(right),
        ),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function isIgnoredSkillSupportDirectory(name: string): boolean {
  return (
    name === 'scripts' ||
    name === 'references' ||
    name === 'assets' ||
    name === 'templates'
  );
}

async function loadIndexbindBuildModule(): Promise<IndexbindBuildModule> {
  try {
    return (await import('indexbind/build')) as IndexbindBuildModule;
  } catch (error) {
    throw new Error(
      `Search build requires the optional package "indexbind". Install it first, for example: npm install indexbind`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function loadIndexbindWebModule(): Promise<IndexbindWebModule> {
  try {
    return (await import('indexbind/web')) as IndexbindWebModule;
  } catch (error) {
    throw new Error(
      `Search query requires the optional package "indexbind". Install it first, for example: npm install indexbind`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function loadIndexbindCloudflareModule(): Promise<IndexbindCloudflareModule> {
  try {
    return (await import('indexbind/cloudflare')) as IndexbindCloudflareModule;
  } catch (error) {
    throw new Error(
      `Search query requires the optional package "indexbind". Install it first, for example: npm install indexbind`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function openWebIndexFromVirtualBundle<
  Entry extends { path: string; mediaType: string },
>(
  bundleEntries: Entry[],
  loadResponse: (entry: Entry) => Promise<Response>,
): Promise<IndexbindWebIndex> {
  const baseUrl = 'https://mdorigin-search.invalid/';
  const bundleMap = new Map(
    bundleEntries.map((entry) => [new URL(entry.path, baseUrl).toString(), entry]),
  );
  const bundleFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const entry = bundleMap.get(requestUrl);
    if (entry) {
      return loadResponse(entry);
    }

    return fetch(input as RequestInfo, init);
  };

  try {
    const cloudflareModule = await loadIndexbindCloudflareModule();
    return await cloudflareModule.openWebIndex(new URL(baseUrl), {
      fetch: bundleFetch,
    });
  } catch (error) {
    if (!isCloudflareWasmImportError(error)) {
      throw error;
    }

    const webModule = await loadIndexbindWebModule();
    return await webModule.openWebIndex(new URL(baseUrl), {
      fetch: bundleFetch,
    });
  }
}

async function openSearchContextFromDirectory(indexDir: string): Promise<{
  index: IndexbindWebIndex;
  documentsById: Map<string, SearchBundleDocument>;
}> {
  const webModule = await loadIndexbindWebModule();
  const [index, documentsById] = await Promise.all([
    webModule.openWebIndex(indexDir),
    readSearchBundleDocumentsFromDirectory(indexDir),
  ]);
  return { index, documentsById };
}

async function openSearchContextFromBundle<
  Entry extends { path: string; mediaType: string },
>(
  bundleEntries: Entry[],
  loadResponse: (entry: Entry) => Promise<Response>,
): Promise<{
  index: IndexbindWebIndex;
  documentsById: Map<string, SearchBundleDocument>;
}> {
  const [index, documentsById] = await Promise.all([
    openWebIndexFromVirtualBundle(bundleEntries, loadResponse),
    readSearchBundleDocumentsFromResponses(bundleEntries, loadResponse),
  ]);
  return { index, documentsById };
}

function createInlineSearchBundleResponse(entry: SearchBundleEntry): Response {
  const headers = new Headers({ 'content-type': entry.mediaType });
  const binaryBody = decodeBase64(entry.base64 ?? '');
  const body =
    entry.kind === 'text'
      ? entry.text ?? ''
      : new Blob([new Uint8Array(binaryBody)], {
          type: entry.mediaType,
        });
  return new Response(body, {
    status: 200,
    headers,
  });
}

function isCloudflareWasmImportError(error: unknown): boolean {
  const targetMessages = [
    'Unknown file extension ".wasm"',
    'WebAssembly.Module(): Argument 0 must be a buffer source',
  ];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);

    if (current instanceof Error) {
      const currentMessage = current.message;
      if (
        targetMessages.some((message) => currentMessage.includes(message)) ||
        (currentMessage.includes('Cannot find module') &&
          currentMessage.includes('indexbind_wasm_bg.js'))
      ) {
        return true;
      }
    }

    const cause = (current as { cause?: unknown }).cause;
    if (!cause) {
      break;
    }

    current = cause;
  }

  return false;
}

function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function resolveSearchQueryOptions(
  query: string,
  defaults: SiteSearchConfig | undefined,
  overrides: SearchQueryOptions | undefined,
): SearchQueryOptions {
  const policyOverride = resolveSearchPolicyOverride(query, defaults?.policy);
  return mergeSearchQueryOptions(mergePolicySearchOptions(defaults, policyOverride), overrides);
}

function resolveSearchPolicyOverride(
  query: string,
  policy: SiteSearchConfig['policy'] | undefined,
): SiteSearchPolicyOverrideConfig | undefined {
  if (!policy) {
    return undefined;
  }

  const queryCharCount = Array.from(query.trim()).length;
  if (queryCharCount === 0) {
    return undefined;
  }

  if (
    policy.shortQuery &&
    queryCharCount <= policy.shortQuery.maxChars
  ) {
    return policy.shortQuery;
  }

  if (
    policy.longQuery &&
    queryCharCount >= policy.longQuery.minChars
  ) {
    return policy.longQuery;
  }

  return undefined;
}

function mergePolicySearchOptions(
  defaults: SiteSearchConfig | undefined,
  policyOverride: SiteSearchPolicyOverrideConfig | undefined,
): SearchQueryOptions {
  const normalized: SearchQueryOptions = {
    topK: defaults?.topK,
    mode: defaults?.mode,
    minScore: defaults?.minScore,
    reranker: defaults?.reranker ? { ...defaults.reranker } : undefined,
    scoreAdjustment: defaults?.scoreAdjustment
      ? { ...defaults.scoreAdjustment }
      : undefined,
  };

  if (!policyOverride) {
    return normalized;
  }

  if (policyOverride.mode === null) {
    normalized.mode = undefined;
  } else if (policyOverride.mode !== undefined) {
    normalized.mode = policyOverride.mode;
  }

  if (policyOverride.minScore === null) {
    normalized.minScore = undefined;
  } else if (policyOverride.minScore !== undefined) {
    normalized.minScore = policyOverride.minScore;
  }

  if (policyOverride.reranker === null) {
    normalized.reranker = undefined;
  } else if (policyOverride.reranker) {
    normalized.reranker = {
      ...(normalized.reranker ?? {}),
      ...policyOverride.reranker,
    };
  }

  if (policyOverride.scoreAdjustment === null) {
    normalized.scoreAdjustment = undefined;
  } else if (policyOverride.scoreAdjustment) {
    normalized.scoreAdjustment = {
      ...(normalized.scoreAdjustment ?? {}),
      ...policyOverride.scoreAdjustment,
    };
  }

  return normalized;
}

function mergeSearchQueryOptions(
  defaults: SearchQueryOptions | undefined,
  overrides: SearchQueryOptions | undefined,
): SearchQueryOptions {
  return {
    topK: overrides?.topK ?? defaults?.topK,
    mode: overrides?.mode ?? defaults?.mode,
    minScore: overrides?.minScore ?? defaults?.minScore,
    reranker:
      overrides?.reranker || defaults?.reranker
        ? {
            ...(defaults?.reranker ?? {}),
            ...(overrides?.reranker ?? {}),
          }
        : undefined,
    relativePathPrefix: overrides?.relativePathPrefix ?? defaults?.relativePathPrefix,
    metadata: overrides?.metadata ?? defaults?.metadata,
    scoreAdjustment:
      overrides?.scoreAdjustment || defaults?.scoreAdjustment
        ? {
            ...(defaults?.scoreAdjustment ?? {}),
            ...(overrides?.scoreAdjustment ?? {}),
          }
        : undefined,
  };
}

function buildIndexbindSearchOptions(options: SearchQueryOptions): SearchQueryOptions | undefined {
  const normalized: SearchQueryOptions = {};

  if (
    typeof options.topK === 'number' &&
    Number.isFinite(options.topK) &&
    Number.isInteger(options.topK) &&
    options.topK > 0
  ) {
    normalized.topK = options.topK;
  }

  if (options.mode === 'hybrid' || options.mode === 'vector') {
    normalized.mode = options.mode;
  }

  if (typeof options.minScore === 'number' && Number.isFinite(options.minScore)) {
    normalized.minScore = options.minScore;
  }

  if (options.reranker) {
    const reranker: SiteSearchRerankerConfig = {};
    if (
      options.reranker.kind === 'embedding-v1' ||
      options.reranker.kind === 'heuristic-v1'
    ) {
      reranker.kind = options.reranker.kind;
    }
    if (
      typeof options.reranker.candidatePoolSize === 'number' &&
      Number.isFinite(options.reranker.candidatePoolSize) &&
      Number.isInteger(options.reranker.candidatePoolSize) &&
      options.reranker.candidatePoolSize > 0
    ) {
      reranker.candidatePoolSize = options.reranker.candidatePoolSize;
    }
    if (Object.keys(reranker).length > 0) {
      normalized.reranker = reranker;
    }
  }

  if (typeof options.relativePathPrefix === 'string' && options.relativePathPrefix !== '') {
    normalized.relativePathPrefix = options.relativePathPrefix;
  }

  if (options.metadata && Object.keys(options.metadata).length > 0) {
    normalized.metadata = options.metadata;
  }

  if (options.scoreAdjustment) {
    const scoreAdjustment: SiteSearchScoreAdjustmentConfig = {};
    if (
      typeof options.scoreAdjustment.metadataNumericMultiplier === 'string' &&
      options.scoreAdjustment.metadataNumericMultiplier !== ''
    ) {
      scoreAdjustment.metadataNumericMultiplier =
        options.scoreAdjustment.metadataNumericMultiplier;
    }
    if (Object.keys(scoreAdjustment).length > 0) {
      normalized.scoreAdjustment = scoreAdjustment;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function hydrateSearchHits(
  hits: SearchHit[],
  documentsById: Map<string, SearchBundleDocument>,
): SearchHit[] {
  return hits.map((hit) => {
    const document = documentsById.get(hit.docId);
    if (!document) {
      return hit;
    }

    return {
      ...hit,
      canonicalUrl: hit.canonicalUrl ?? document.canonicalUrl ?? undefined,
      title: hit.title ?? document.title ?? undefined,
      summary: hit.summary ?? document.summary ?? undefined,
      metadata:
        Object.keys(hit.metadata).length > 0
          ? hit.metadata
          : document.metadata ?? hit.metadata,
    };
  });
}

async function readSearchBundleDocumentsFromDirectory(
  indexDir: string,
): Promise<Map<string, SearchBundleDocument>> {
  const manifest = JSON.parse(
    await readFile(path.join(indexDir, 'manifest.json'), 'utf8'),
  ) as SearchBundleManifest;
  const documentsFile = manifest.files?.documents;
  if (!documentsFile) {
    return new Map();
  }

  const documents = JSON.parse(
    await readFile(path.join(indexDir, documentsFile), 'utf8'),
  ) as SearchBundleDocument[];
  return new Map(documents.map((document) => [document.docId, document]));
}

async function readSearchBundleDocumentsFromResponses<
  Entry extends { path: string; mediaType: string },
>(
  bundleEntries: Entry[],
  loadResponse: (entry: Entry) => Promise<Response>,
): Promise<Map<string, SearchBundleDocument>> {
  const manifestEntry = bundleEntries.find((entry) => entry.path === 'manifest.json');
  if (!manifestEntry) {
    return new Map();
  }

  const manifest = JSON.parse(
    await loadBundleResponseText(manifestEntry, loadResponse),
  ) as SearchBundleManifest;
  const documentsFile = manifest.files?.documents;
  if (!documentsFile) {
    return new Map();
  }

  const documentsEntry = bundleEntries.find((entry) => entry.path === documentsFile);
  if (!documentsEntry) {
    return new Map();
  }

  const documents = JSON.parse(
    await loadBundleResponseText(documentsEntry, loadResponse),
  ) as SearchBundleDocument[];
  return new Map(documents.map((document) => [document.docId, document]));
}

async function loadBundleResponseText<
  Entry extends { path: string; mediaType: string },
>(
  entry: Entry,
  loadResponse: (entry: Entry) => Promise<Response>,
): Promise<string> {
  const response = await loadResponse(entry);
  if (!response.ok) {
    throw new Error(
      `Failed to read search bundle file ${entry.path}: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

function rerankSearchHits(hits: SearchHit[]): SearchHit[] {
  const remaining = [...hits];
  const ordered: SearchHit[] = [];

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateScore = getDiversifiedSearchRankScore(candidate, ordered);
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestIndex = index;
        continue;
      }

      if (
        Math.abs(candidateScore - bestScore) <= 1e-9 &&
        compareHits(candidate, remaining[bestIndex]!) < 0
      ) {
        bestIndex = index;
      }
    }

    ordered.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return ordered;
}

function getDiversifiedSearchRankScore(
  hit: SearchHit,
  selectedHits: readonly SearchHit[],
): number {
  let adjusted = hit.score;
  const candidateSection = getTopLevelSection(hit.relativePath);
  const sameSectionCount = selectedHits.filter(
    (selectedHit) => getTopLevelSection(selectedHit.relativePath) === candidateSection,
  ).length;

  if (sameSectionCount > 0) {
    adjusted *= Math.pow(0.9, sameSectionCount);
  }

  if (isOverviewSearchHit(hit)) {
    adjusted *= sameSectionCount > 0 ? 0.72 : 0.84;
  }

  return adjusted;
}

function compareHits(left: SearchHit, right: SearchHit): number {
  if (right.bestMatch.score !== left.bestMatch.score) {
    return right.bestMatch.score - left.bestMatch.score;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function isOverviewSearchHit(hit: SearchHit): boolean {
  return OVERVIEW_CONTENT_FILENAMES.has(
    path.posix.basename(hit.relativePath).toLowerCase(),
  );
}

function getTopLevelSection(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  const [firstSegment] = normalized.split('/', 1);
  return firstSegment ?? '';
}

const DIRECTORY_INDEX_FILENAMES_LOWER = new Set(
  getDirectoryIndexCandidates('').map((name) => name.toLowerCase()),
);
