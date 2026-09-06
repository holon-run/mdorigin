import type {
  ContentDirectoryEntry,
  ContentEntry,
  ContentEntryKind,
  ContentStore,
} from '../core/content-store.js';
import { MemoryContentStore } from '../core/content-store.js';
import type { MdoPlugin } from '../core/extensions.js';
import { handleSiteRequest } from '../core/request-handler.js';
import type { SiteResponse } from '../core/request-handler.js';
import { resolveRequest } from '../core/router.js';
import type { ResolvedRequest } from '../core/router.js';
import type { ResolvedSiteConfig } from '../core/site-config.js';
import {
  createSearchApiFromBundle,
  createSearchApiFromExternalBundle,
  type ExternalSearchBundleEntry,
  type SearchApi,
  type SearchBundleEntry,
  type SearchHit,
} from '../search.js';

export interface TextCloudflareManifestEntry {
  path: string;
  kind: 'text';
  mediaType: string;
  text?: string;
}

export interface InlineBinaryCloudflareManifestEntry {
  path: string;
  kind: 'binary';
  mediaType: string;
  base64?: string;
}

export interface ExternalBinaryCloudflareManifestEntry {
  path: string;
  kind: 'binary';
  mediaType: string;
  storageKind: 'assets' | 'r2';
  storageKey: string;
  byteSize: number;
}

export type CloudflareManifestEntry =
  | TextCloudflareManifestEntry
  | InlineBinaryCloudflareManifestEntry
  | ExternalBinaryCloudflareManifestEntry;

export interface CloudflareBundleRuntimeConfig {
  binaryMode: 'inline' | 'external';
  r2Binding?: string;
}

export interface CloudflareManifest {
  entries: CloudflareManifestEntry[];
  siteConfig?: ResolvedSiteConfig;
  searchEntries?: SearchBundleEntry[];
  externalSearchEntries?: ExternalSearchBundleEntry[];
  runtime?: CloudflareBundleRuntimeConfig;
  /**
   * Build-time deploy version. Bundle content is immutable within one deploy,
   * so this value doubles as a strong ETag and lets If-None-Match matches skip
   * rendering entirely. A new deploy produces a new version and invalidates
   * every cached response.
   */
  deployVersion?: string;
}

export interface CloudflareAssetsBindingLike {
  fetch(request: Request): Promise<Response>;
}

export interface CloudflareR2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface CloudflareR2ObjectLike {
  body: CloudflareR2ObjectBodyLike | ReadableStream | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  httpEtag?: string;
}

export interface CloudflareR2BucketLike {
  get(key: string): Promise<CloudflareR2ObjectLike | null>;
}

export interface CloudflareWorkerEnv {
  ASSETS?: CloudflareAssetsBindingLike;
  [binding: string]: unknown;
}

export interface ExportedHandlerLike {
  fetch(
    request: Request,
    env?: CloudflareWorkerEnv,
    ctx?: CloudflareWorkerExecutionContextLike,
  ): Promise<Response>;
}

export interface CloudflareWorkerExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface CloudflareCacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface CreateCloudflareWorkerOptions {
  plugins?: MdoPlugin[];
  /**
   * Per-colo L2 cache. Defaults to the runtime `caches.default` when the
   * runtime exposes one. Pass `null` to disable L2 caching.
   */
  cache?: CloudflareCacheLike | null;
  /** Maximum isolate-memoized rendered responses. Defaults to 100. */
  responseCacheLimit?: number;
  /** Maximum isolate-memoized search results. Defaults to 100. */
  searchCacheLimit?: number;
}

const BROWSER_CACHE_CONTROL = 'public, max-age=120, stale-while-revalidate=604800';
const CDN_CACHE_CONTROL = 'max-age=86400';
const L2_CACHE_CONTROL = 'public, max-age=86400';
const L2_CACHE_KEY_ORIGIN = 'https://cache.mdorigin.internal';
const CACHE_DEBUG_HEADER = 'x-mdorigin-cache';
const RESPONSE_CACHE_LIMIT_DEFAULT = 100;
const SEARCH_CACHE_LIMIT_DEFAULT = 100;
const CACHEABLE_CONTENT_TYPE_PREFIXES = [
  'text/html',
  'text/markdown',
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml',
] as const;

export function createCloudflareWorker(
  manifest: CloudflareManifest,
  options: CreateCloudflareWorkerOptions = {},
): ExportedHandlerLike {
  const storeIndex = new MemoryContentStore(
    manifest.entries.map((entry): ContentEntry => {
      if (entry.kind === 'text') {
        return {
          path: entry.path,
          kind: 'text',
          mediaType: entry.mediaType,
          text: entry.text ?? '',
        };
      }

      if ('storageKind' in entry) {
        return {
          path: entry.path,
          kind: 'binary',
          mediaType: entry.mediaType,
        };
      }

      return {
        path: entry.path,
        kind: 'binary',
        mediaType: entry.mediaType,
        bytes: decodeBase64(entry.base64 ?? ''),
      };
    }),
  );
  const responseCache = new LruCache<CachedResponse>(
    options.responseCacheLimit ?? RESPONSE_CACHE_LIMIT_DEFAULT,
  );
  const searchCacheLimit = options.searchCacheLimit ?? SEARCH_CACHE_LIMIT_DEFAULT;
  const cache =
    options.cache === undefined ? resolveDefaultCache() : options.cache ?? undefined;
  const inlineSearchApi =
    manifest.searchEntries && manifest.searchEntries.length > 0
      ? withSearchResultCache(
          createSearchApiFromBundle(manifest.searchEntries, manifest.siteConfig?.search),
          searchCacheLimit,
        )
      : undefined;
  const externalSearchApis = new WeakMap<
    CloudflareWorkerEnv,
    ReturnType<typeof createSearchApiFromExternalBundle>
  >();
  let defaultExternalSearchApi:
    | ReturnType<typeof createSearchApiFromExternalBundle>
    | undefined;

  return {
    async fetch(
      request: Request,
      env?: CloudflareWorkerEnv,
      ctx?: CloudflareWorkerExecutionContextLike,
    ): Promise<Response> {
      const url = new URL(request.url);
      const externalSearchApi = getExternalSearchApi(
        manifest,
        env,
        externalSearchApis,
        defaultExternalSearchApi,
        searchCacheLimit,
      );
      if (env === undefined && externalSearchApi !== undefined) {
        defaultExternalSearchApi = externalSearchApi;
      }
      const resolvedRequest = resolveRequest(url.pathname);
      const directBinaryResponse = await tryServeExternalBinary(
        manifest,
        request,
        env,
        resolvedRequest,
      );
      if (directBinaryResponse !== null) {
        return directBinaryResponse;
      }
      const etag =
        manifest.deployVersion === undefined
          ? undefined
          : `"${manifest.deployVersion}"`;
      if (
        etag !== undefined &&
        isCacheableRequest(request, url) &&
        requestMatchesEtag(request.headers.get('if-none-match'), etag)
      ) {
        return new Response(null, {
          status: 304,
          headers: {
            etag,
            'cache-control': BROWSER_CACHE_CONTROL,
          },
        });
      }
      const cacheDebugEnabled = isCacheDebugEnabled(env);
      const responseCacheKey =
        manifest.deployVersion !== undefined && isCacheableRequest(request, url)
          ? buildResponseCacheKey(
              manifest.deployVersion,
              resolvedRequest,
              request.headers.get('accept'),
              url.pathname,
            )
          : undefined;
      if (responseCacheKey !== undefined) {
        const memoized = responseCache.get(responseCacheKey);
        if (memoized !== undefined) {
          return toWorkerResponse(memoized, cacheDebugEnabled ? 'l1' : undefined);
        }
        if (cache !== undefined) {
          const cached = await cache.match(toL2CacheRequest(responseCacheKey));
          if (cached !== undefined) {
            const entry = await cachedResponseFromL2(cached);
            if (entry !== null) {
              responseCache.set(responseCacheKey, entry);
              return toWorkerResponse(entry, cacheDebugEnabled ? 'l2' : undefined);
            }
          }
        }
      }
      const store = new CloudflareManifestContentStore(manifest, storeIndex, request, env);
      const siteResponse = await handleSiteRequest(store, url.pathname, {
        draftMode: 'exclude',
        siteConfig: manifest.siteConfig ?? {
          siteTitle: 'mdorigin',
          siteUrl: undefined,
          locale: 'en',
          messages: {},
          favicon: undefined,
          logo: undefined,
          showDate: true,
          showSummary: true,
          topNav: [],
          footerNav: [],
          footerText: undefined,
          socialLinks: [],
          editLink: undefined,
          showHomeIndex: true,
          listingInitialPostCount: 10,
          listingLoadMoreStep: 10,
          siteTitleConfigured: false,
          siteDescriptionConfigured: false,
        },
        acceptHeader: request.headers.get('accept') ?? undefined,
        searchParams: url.searchParams,
        requestUrl: request.url,
        searchApi: inlineSearchApi ?? externalSearchApi,
        plugins: options.plugins,
      });

      const headers = new Headers(siteResponse.headers);
      const cacheHeaders = collectResponseCacheHeaders(
        siteResponse,
        request,
        url,
        etag,
      );
      if (cacheHeaders !== undefined) {
        for (const [name, value] of Object.entries(cacheHeaders)) {
          headers.set(name, value);
        }
      }
      const rendered: CachedResponse = {
        status: siteResponse.status,
        headers: Object.fromEntries(headers.entries()),
        body: siteResponse.body ?? '',
      };
      if (
        responseCacheKey !== undefined &&
        siteResponse.status === 200 &&
        isCacheableContentType(siteResponse.headers['content-type'])
      ) {
        responseCache.set(responseCacheKey, rendered);
        if (cache !== undefined) {
          const putPromise = cache.put(
            toL2CacheRequest(responseCacheKey),
            toL2CacheResponse(rendered),
          );
          if (ctx?.waitUntil !== undefined) {
            ctx.waitUntil(putPromise);
          } else {
            await putPromise;
          }
        }
      }
      return toWorkerResponse(
        rendered,
        cacheDebugEnabled && responseCacheKey !== undefined ? 'miss' : undefined,
      );
    },
  };
}

function isCacheableRequest(request: Request, url: URL): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }
  if (url.search !== '') {
    return false;
  }
  return url.pathname !== '/api' && !url.pathname.startsWith('/api/');
}

function isCacheableContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined || mediaType === '') {
    return false;
  }
  return CACHEABLE_CONTENT_TYPE_PREFIXES.some(
    (prefix) => mediaType === prefix || mediaType.startsWith(`${prefix}/`),
  );
}

function requestMatchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null || ifNoneMatch.trim() === '') {
    return false;
  }
  if (ifNoneMatch.trim() === '*') {
    return true;
  }
  return ifNoneMatch.split(',').some((candidate) => {
    const trimmed = candidate.trim();
    const value = trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
    return value === etag;
  });
}

function collectResponseCacheHeaders(
  siteResponse: SiteResponse,
  request: Request,
  url: URL,
  etag: string | undefined,
): Record<string, string> | undefined {
  if (
    etag === undefined ||
    siteResponse.status !== 200 ||
    !isCacheableRequest(request, url) ||
    !isCacheableContentType(siteResponse.headers['content-type'])
  ) {
    return undefined;
  }
  const cacheHeaders: Record<string, string> = {
    etag,
    'cache-control': BROWSER_CACHE_CONTROL,
  };
  const varyValues =
    siteResponse.headers['vary']
      ?.split(',')
      .map((value) => value.trim().toLowerCase()) ?? [];
  // The Cloudflare edge cache does not vary on Accept, so extensionless
  // content-negotiated routes must stay out of the CDN cache. They still get
  // ETag/304 handling and browser revalidation.
  if (!varyValues.includes('accept')) {
    cacheHeaders['cdn-cache-control'] = CDN_CACHE_CONTROL;
  }
  return cacheHeaders;
}

interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | string;
}

class LruCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly limit: number) {}

  get(key: string): T | undefined {
    const cached = this.entries.get(key);
    if (cached === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, cached);
    return cached;
  }

  set(key: string, value: T): void {
    if (this.limit <= 0) {
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }
}

/**
 * Memoizes deterministic search results per isolate. The search index is
 * static within one deploy, so identical (query, options) calls return the
 * same hits and repeated queries skip retrieval entirely.
 */
export function withSearchResultCache(api: SearchApi, limit: number): SearchApi {
  if (limit <= 0) {
    return api;
  }
  const cache = new LruCache<SearchHit[]>(limit);
  return {
    async search(query, options) {
      const key = JSON.stringify([query, options ?? null]);
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const hits = await api.search(query, options);
      cache.set(key, hits);
      return hits;
    },
  };
}

function resolveDefaultCache(): CloudflareCacheLike | undefined {
  const cachesRef = (globalThis as { caches?: { default?: CloudflareCacheLike } })
    .caches;
  const defaultCache = cachesRef?.default;
  if (
    defaultCache === undefined ||
    typeof defaultCache.match !== 'function' ||
    typeof defaultCache.put !== 'function'
  ) {
    return undefined;
  }
  return defaultCache;
}

function isCacheDebugEnabled(env: CloudflareWorkerEnv | undefined): boolean {
  const value = env?.MDORIGIN_CACHE_DEBUG;
  return value === '1' || value === 'true';
}

function buildResponseCacheKey(
  deployVersion: string,
  resolved: ResolvedRequest,
  acceptHeader: string | null,
  pathname: string,
): string {
  const variant = resolveCacheVariant(resolved, acceptHeader);
  return `${deployVersion}/${variant}${pathname}`;
}

function resolveCacheVariant(
  resolved: ResolvedRequest,
  acceptHeader: string | null,
): 'md' | 'html' {
  if (resolved.kind === 'markdown') {
    return 'md';
  }
  if (
    resolved.kind === 'html' &&
    !resolved.requestPath.endsWith('.html') &&
    acceptsMarkdown(acceptHeader)
  ) {
    return 'md';
  }
  return 'html';
}

function acceptsMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return false;
  }
  return acceptHeader
    .split(',')
    .map((part) => part.split(';', 1)[0]?.trim().toLowerCase())
    .includes('text/markdown');
}

function toL2CacheRequest(cacheKey: string): Request {
  return new Request(`${L2_CACHE_KEY_ORIGIN}/${cacheKey}`);
}

function toL2CacheResponse(entry: CachedResponse): Response {
  const headers = new Headers(entry.headers);
  headers.set('cache-control', L2_CACHE_CONTROL);
  return new Response(toResponseBody(entry), {
    status: entry.status,
    headers,
  });
}

async function cachedResponseFromL2(
  cached: Response,
): Promise<CachedResponse | null> {
  if (cached.status !== 200) {
    return null;
  }
  const headers = new Headers(cached.headers);
  headers.set('cache-control', BROWSER_CACHE_CONTROL);
  const headerEntries: Record<string, string> = {};
  headers.forEach((value, name) => {
    headerEntries[name] = value;
  });
  return {
    status: cached.status,
    headers: headerEntries,
    body: new Uint8Array(await cached.arrayBuffer()),
  };
}

function toWorkerResponse(
  entry: CachedResponse,
  cacheStatus: string | undefined,
): Response {
  const headers = new Headers(entry.headers);
  if (cacheStatus !== undefined) {
    headers.set(CACHE_DEBUG_HEADER, cacheStatus);
  }
  return new Response(toResponseBody(entry), {
    status: entry.status,
    headers,
  });
}

function toResponseBody(entry: CachedResponse): Blob | string {
  if (entry.body instanceof Uint8Array) {
    return new Blob([Uint8Array.from(entry.body)], {
      type: entry.headers['content-type'],
    });
  }
  return entry.body;
}

function getExternalSearchApi(
  manifest: CloudflareManifest,
  env: CloudflareWorkerEnv | undefined,
  cache: WeakMap<CloudflareWorkerEnv, ReturnType<typeof createSearchApiFromExternalBundle>>,
  defaultApi: ReturnType<typeof createSearchApiFromExternalBundle> | undefined,
  searchCacheLimit: number,
): ReturnType<typeof createSearchApiFromExternalBundle> | undefined {
  if (!manifest.externalSearchEntries || manifest.externalSearchEntries.length === 0) {
    return undefined;
  }

  if (!env) {
    return (
      defaultApi ??
      withSearchResultCache(
        createSearchApiFromExternalBundle(
          manifest.externalSearchEntries,
          async (entry) =>
            loadExternalSearchEntryResponse(entry, undefined, manifest.runtime?.r2Binding),
          manifest.siteConfig?.search,
        ),
        searchCacheLimit,
      )
    );
  }

  const cached = cache.get(env);
  if (cached) {
    return cached;
  }

  const searchApi = withSearchResultCache(
    createSearchApiFromExternalBundle(
      manifest.externalSearchEntries,
      async (entry) =>
        loadExternalSearchEntryResponse(entry, env, manifest.runtime?.r2Binding),
      manifest.siteConfig?.search,
    ),
    searchCacheLimit,
  );
  cache.set(env, searchApi);
  return searchApi;
}

async function loadExternalSearchEntryResponse(
  entry: ExternalSearchBundleEntry,
  env: CloudflareWorkerEnv | undefined,
  r2Binding: string | undefined,
): Promise<Response> {
  if (entry.storageKind === 'assets') {
    const assetsBinding = env?.ASSETS;
    if (!assetsBinding) {
      throw new Error(
        `Cloudflare ASSETS binding is required to serve search bundle file ${entry.path}.`,
      );
    }

    const assetResponse = await assetsBinding.fetch(
      new Request(new URL(`/${entry.storageKey}`, 'https://mdorigin-search.invalid/'), {
        method: 'GET',
      }),
    );
    if (assetResponse.ok) {
      return assetResponse;
    }

    return new Response('Not Found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const bindingName = r2Binding ?? 'MDORIGIN_R2';
  const bucket = env?.[bindingName] as CloudflareR2BucketLike | undefined;
  if (!bucket) {
    throw new Error(
      `Cloudflare R2 binding ${bindingName} is required to serve search bundle file ${entry.path}.`,
    );
  }

  const object = await bucket.get(entry.storageKey);
  if (!object) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const headers = new Headers({
    'content-type': entry.mediaType,
  });
  if (object.httpEtag) {
    headers.set('etag', object.httpEtag);
  }

  if (object.body instanceof ReadableStream) {
    return new Response(object.body, {
      status: 200,
      headers,
    });
  }

  if (object.body && 'arrayBuffer' in object.body) {
    return new Response(await object.body.arrayBuffer(), {
      status: 200,
      headers,
    });
  }

  if (typeof object.arrayBuffer === 'function') {
    return new Response(await object.arrayBuffer(), {
      status: 200,
      headers,
    });
  }

  return new Response(null, {
    status: 200,
    headers,
  });
}

async function tryServeExternalBinary(
  manifest: CloudflareManifest,
  request: Request,
  env: CloudflareWorkerEnv | undefined,
  resolved: ResolvedRequest,
): Promise<Response | null> {
  if (resolved.kind !== 'asset' || !resolved.sourcePath) {
    return null;
  }

  const manifestEntry = manifest.entries.find(
    (entry): entry is ExternalBinaryCloudflareManifestEntry =>
      entry.path === resolved.sourcePath && isExternalBinaryEntry(entry),
  );
  if (!manifestEntry) {
    return null;
  }

  if (manifestEntry.storageKind === 'assets') {
    const assetsBinding = env?.ASSETS;
    if (!assetsBinding) {
      throw new Error(
        `Cloudflare ASSETS binding is required to serve ${manifestEntry.path}.`,
      );
    }

    const assetUrl = new URL(request.url);
    assetUrl.pathname = `/${manifestEntry.storageKey}`;
    return assetsBinding.fetch(new Request(assetUrl.toString(), request));
  }

  const bucket = env?.[
    manifest.runtime?.r2Binding ?? 'MDORIGIN_R2'
  ] as CloudflareR2BucketLike | undefined;
  if (!bucket) {
    throw new Error(
      `Cloudflare R2 binding ${manifest.runtime?.r2Binding ?? 'MDORIGIN_R2'} is required to serve ${manifestEntry.path}.`,
    );
  }

  const object = await bucket.get(manifestEntry.storageKey);
  if (!object) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const headers = new Headers({
    'content-type': manifestEntry.mediaType,
  });
  if (object.httpEtag) {
    headers.set('etag', object.httpEtag);
  }

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  if (object.body instanceof ReadableStream) {
    return new Response(object.body, {
      status: 200,
      headers,
    });
  }

  if (object.body && 'arrayBuffer' in object.body) {
    return new Response(await object.body.arrayBuffer(), {
      status: 200,
      headers,
    });
  }

  if (typeof object.arrayBuffer === 'function') {
    return new Response(await object.arrayBuffer(), {
      status: 200,
      headers,
    });
  }

  return new Response(null, {
    status: 200,
    headers,
  });
}

function isExternalBinaryEntry(
  entry: CloudflareManifestEntry,
): entry is ExternalBinaryCloudflareManifestEntry {
  return entry.kind === 'binary' && 'storageKind' in entry;
}

class CloudflareManifestContentStore implements ContentStore {
  private readonly entries: Map<string, CloudflareManifestEntry>;
  private readonly runtime: CloudflareBundleRuntimeConfig | undefined;

  constructor(
    manifest: CloudflareManifest,
    private readonly storeIndex: MemoryContentStore,
    private readonly request: Request,
    private readonly env: CloudflareWorkerEnv | undefined,
  ) {
    this.entries = new Map(manifest.entries.map((entry) => [entry.path, entry]));
    this.runtime = manifest.runtime;
  }

  async get(contentPath: string): Promise<ContentEntry | null> {
    const baseEntry = await this.storeIndex.get(contentPath);
    if (baseEntry === null) {
      return null;
    }

    const manifestEntry = this.entries.get(contentPath);
    if (!manifestEntry || manifestEntry.kind === 'text') {
      return baseEntry;
    }

    if (!('storageKind' in manifestEntry)) {
      return baseEntry;
    }

    if (manifestEntry.storageKind === 'assets') {
      const assetsBinding = this.env?.ASSETS;
      if (!assetsBinding) {
        throw new Error(
          `Cloudflare ASSETS binding is required to serve ${manifestEntry.path}.`,
        );
      }

      const assetResponse = await assetsBinding.fetch(
        new Request(new URL(`/${manifestEntry.storageKey}`, this.request.url), {
          method: 'GET',
        }),
      );
      if (!assetResponse.ok) {
        return null;
      }

      return {
        path: manifestEntry.path,
        kind: 'binary',
        mediaType: manifestEntry.mediaType,
        bytes: new Uint8Array(await assetResponse.arrayBuffer()),
      };
    }

    const r2BindingName = this.findR2BindingName(manifestEntry);
    const bucket = this.env?.[r2BindingName] as CloudflareR2BucketLike | undefined;
    if (!bucket) {
      throw new Error(
        `Cloudflare R2 binding ${r2BindingName} is required to serve ${manifestEntry.path}.`,
      );
    }

    const object = await bucket.get(manifestEntry.storageKey);
    if (!object) {
      return null;
    }

    const arrayBuffer =
      typeof object.arrayBuffer === 'function'
        ? await object.arrayBuffer()
        : object.body instanceof ReadableStream
          ? await new Response(object.body).arrayBuffer()
          : object.body && 'arrayBuffer' in object.body
            ? await object.body.arrayBuffer()
            : new ArrayBuffer(0);

    return {
      path: manifestEntry.path,
      kind: 'binary',
      mediaType: manifestEntry.mediaType,
      bytes: new Uint8Array(arrayBuffer),
    };
  }

  async listDirectory(contentPath: string): Promise<ContentDirectoryEntry[] | null> {
    return this.storeIndex.listDirectory(contentPath);
  }

  private findR2BindingName(
    entry: ExternalBinaryCloudflareManifestEntry,
  ): string {
    if (entry.storageKind !== 'r2') {
      return 'ASSETS';
    }

    return this.runtime?.r2Binding ?? 'MDORIGIN_R2';
  }
}

function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
