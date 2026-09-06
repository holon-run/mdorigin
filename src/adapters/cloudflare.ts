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
import type { ResolvedSiteConfig } from '../core/site-config.js';
import {
  createSearchApiFromBundle,
  createSearchApiFromExternalBundle,
  type ExternalSearchBundleEntry,
  type SearchBundleEntry,
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
    ctx?: unknown,
  ): Promise<Response>;
}

export interface CreateCloudflareWorkerOptions {
  plugins?: MdoPlugin[];
}

const BROWSER_CACHE_CONTROL = 'public, max-age=120, stale-while-revalidate=604800';
const CDN_CACHE_CONTROL = 'max-age=86400';
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
  const inlineSearchApi =
    manifest.searchEntries && manifest.searchEntries.length > 0
      ? createSearchApiFromBundle(manifest.searchEntries, manifest.siteConfig?.search)
      : undefined;
  const externalSearchApis = new WeakMap<
    CloudflareWorkerEnv,
    ReturnType<typeof createSearchApiFromExternalBundle>
  >();
  let defaultExternalSearchApi:
    | ReturnType<typeof createSearchApiFromExternalBundle>
    | undefined;

  return {
    async fetch(request: Request, env?: CloudflareWorkerEnv): Promise<Response> {
      const url = new URL(request.url);
      const externalSearchApi = getExternalSearchApi(
        manifest,
        env,
        externalSearchApis,
        defaultExternalSearchApi,
      );
      if (env === undefined && externalSearchApi !== undefined) {
        defaultExternalSearchApi = externalSearchApi;
      }
      const directBinaryResponse = await tryServeExternalBinary(
        manifest,
        request,
        env,
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
      const body =
        siteResponse.body instanceof Uint8Array
          ? new Blob([Uint8Array.from(siteResponse.body)], {
              type: siteResponse.headers['content-type'],
            })
          : siteResponse.body ?? '';

      return new Response(body, {
        status: siteResponse.status,
        headers,
      });
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

function getExternalSearchApi(
  manifest: CloudflareManifest,
  env: CloudflareWorkerEnv | undefined,
  cache: WeakMap<CloudflareWorkerEnv, ReturnType<typeof createSearchApiFromExternalBundle>>,
  defaultApi: ReturnType<typeof createSearchApiFromExternalBundle> | undefined,
): ReturnType<typeof createSearchApiFromExternalBundle> | undefined {
  if (!manifest.externalSearchEntries || manifest.externalSearchEntries.length === 0) {
    return undefined;
  }

  if (!env) {
    return (
      defaultApi ??
      createSearchApiFromExternalBundle(
        manifest.externalSearchEntries,
        async (entry) =>
          loadExternalSearchEntryResponse(entry, undefined, manifest.runtime?.r2Binding),
        manifest.siteConfig?.search,
      )
    );
  }

  const cached = cache.get(env);
  if (cached) {
    return cached;
  }

  const searchApi = createSearchApiFromExternalBundle(
    manifest.externalSearchEntries,
    async (entry) =>
      loadExternalSearchEntryResponse(entry, env, manifest.runtime?.r2Binding),
    manifest.siteConfig?.search,
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
): Promise<Response | null> {
  const resolved = resolveRequest(new URL(request.url).pathname);
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
