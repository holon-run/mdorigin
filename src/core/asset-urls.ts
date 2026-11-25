/**
 * External asset origin support.
 *
 * Sites deployed with external binary mode can serve rendered asset
 * references from a second origin that mirrors the site's public path
 * structure, such as a custom domain bound to the same Worker or a CDN in
 * front of the site. When `assets.baseUrl` is configured, rendered asset
 * references are rewritten to that origin while keeping the same public
 * path structure, so the Worker route keeps working as a fallback for
 * crawlers and old links.
 *
 * A raw R2 custom domain is not a compatible origin: external binary mode
 * stages bucket objects at content-hash keys (binary/<sha256><ext>), which
 * an R2 domain serves by key rather than by public path (see #38).
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
 * external binary asset paths. Asset paths use content-path form (decoded,
 * no leading slash) so they match manifest entries directly.
 */
export function createExternalAssetUrlResolver(
  baseUrl: string,
  assetPaths: ReadonlySet<string>,
): AssetUrlResolver {
  const normalizedBaseUrl = normalizeAssetBaseUrl(baseUrl);

  return (href, pageRequestPath) => {
    if (href === '' || assetPaths.size === 0) {
      return undefined;
    }

    // Already absolute or protocol-relative references stay untouched.
    if (href.startsWith('//') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) {
      return undefined;
    }

    const directory =
      pageRequestPath.includes('/')
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

    const assetPath = toContentPathForm(resolved.pathname);
    if (assetPath === null || !assetPaths.has(assetPath)) {
      return undefined;
    }

    // Emit the URL-encoded path: percent-encoded hrefs stay encoded and
    // raw unicode hrefs become correctly encoded absolute URLs. Query and
    // fragment (cache-busting, anchors) are preserved as written.
    return `${normalizedBaseUrl}${resolved.pathname}${resolved.search}${resolved.hash}`;
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

