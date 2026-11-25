/**
 * External asset origin support.
 *
 * Sites deployed with external binary mode can serve rendered asset
 * references from a second origin. `assets.addressing` selects the URL
 * shape: 'path' origins mirror the site's public path structure (a custom
 * domain bound to the same Worker or a CDN in front of the site), while
 * 'key' origins serve the R2 bucket by object key (such as an R2 custom
 * domain), where external binary mode stages bucket objects at
 * content-hash keys (binary/<sha256><ext>). In both cases the Worker route
 * keeps serving the same paths as a fallback for crawlers and old links.
 */

/**
 * Resolves a rendered asset href to an external absolute URL.
 *
 * @param href Asset reference as written in content: relative (`./a.png`),
 *   root-relative (`/a.png`), or already absolute (returned unchanged by
 *   concrete implementations).
 * @param pageRequestPath URL path of the page being rendered, used to resolve
 *   relative references the same way a browser would.
 * @returns The absolute external URL, or undefined when the reference should
 *   not be rewritten.
 */
export type AssetUrlResolver = (
  href: string,
  pageRequestPath: string,
) => string | undefined;

const RESOLUTION_BASE_ORIGIN = 'https://asset.mdorigin.invalid';

/**
 * Builds a resolver that rewrites hrefs resolving to one of the known
 * external binary asset paths, preserving the public path shape. Asset
 * paths use content-path form (decoded, no leading slash) so they match
 * manifest entries directly.
 */
export function createExternalAssetUrlResolver(
  baseUrl: string,
  assetPaths: ReadonlySet<string>,
): AssetUrlResolver {
  const normalizedBaseUrl = normalizeAssetBaseUrl(baseUrl);

  return (href, pageRequestPath) => {
    const match = resolveExternalAssetHref(href, pageRequestPath);
    if (match === undefined || !assetPaths.has(match.contentPath)) {
      return undefined;
    }

    // Emit the URL-encoded path: percent-encoded hrefs stay encoded and
    // raw unicode hrefs become correctly encoded absolute URLs. Query and
    // fragment (cache-busting, anchors) are preserved as written.
    return `${normalizedBaseUrl}${match.pathname}${match.search}${match.hash}`;
  };
}

/**
 * Builds a resolver that rewrites hrefs resolving to one of the known
 * external binary asset paths to their content-hash storage key
 * (binary/<sha256><ext>), for origins that serve the R2 bucket by key such
 * as an R2 custom domain (see #38). Keys are emitted verbatim from the
 * manifest; query and fragment are preserved as written.
 */
export function createStorageKeyAssetUrlResolver(
  baseUrl: string,
  assetKeys: ReadonlyMap<string, string>,
): AssetUrlResolver {
  const normalizedBaseUrl = normalizeAssetBaseUrl(baseUrl);

  return (href, pageRequestPath) => {
    const match = resolveExternalAssetHref(href, pageRequestPath);
    if (match === undefined) {
      return undefined;
    }

    const storageKey = assetKeys.get(match.contentPath);
    if (storageKey === undefined) {
      return undefined;
    }

    return `${normalizedBaseUrl}/${storageKey}${match.search}${match.hash}`;
  };
}

interface ExternalAssetHrefMatch {
  contentPath: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Resolves a rendered asset href against the page request path the same way
 * a browser would. Returns undefined when the reference is not a
 * site-relative asset path.
 */
function resolveExternalAssetHref(
  href: string,
  pageRequestPath: string,
): ExternalAssetHrefMatch | undefined {
  if (href === '') {
    return undefined;
  }

  // Already absolute or protocol-relative references stay untouched.
  if (href.startsWith('//') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) {
    return undefined;
  }

  const directory = pageRequestPath.includes('/')
    ? pageRequestPath.slice(0, pageRequestPath.lastIndexOf('/') + 1)
    : '/';
  let resolved: URL;
  try {
    resolved = new URL(href, `${RESOLUTION_BASE_ORIGIN}${directory}`);
  } catch {
    return undefined;
  }
  if (resolved.origin !== RESOLUTION_BASE_ORIGIN) {
    return undefined;
  }

  const contentPath = toContentPathForm(resolved.pathname);
  if (contentPath === null) {
    return undefined;
  }

  return {
    contentPath,
    pathname: resolved.pathname,
    search: resolved.search,
    hash: resolved.hash,
  };
}

/** Applies a resolver to an optional href, leaving non-matching values unchanged. */
export function applyAssetUrlResolver(
  href: string | undefined,
  pageRequestPath: string,
  resolver: AssetUrlResolver | undefined,
): string | undefined {
  if (href === undefined || resolver === undefined) {
    return href;
  }

  return resolver(href, pageRequestPath) ?? href;
}

/**
 * Normalizes an asset base URL: must be an absolute http(s) URL; trailing
 * slashes are removed so `${baseUrl}${path}` concatenation stays correct.
 */
export function normalizeAssetBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid asset base URL: ${value} is not an absolute URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid asset base URL: ${value} must use http or https`,
    );
  }

  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Converts a percent-encoded URL pathname to content-path form (decoded, no
 * leading slash), matching how the router resolves request paths to manifest
 * entries. Returns null when the pathname cannot be decoded.
 */
function toContentPathForm(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    const withoutLeadingSlash = decoded.replace(/^\/+/, '');
    if (withoutLeadingSlash === '') {
      return null;
    }

    return withoutLeadingSlash;
  } catch {
    return null;
  }
}

