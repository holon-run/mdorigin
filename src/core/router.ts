import path from 'node:path';

import { normalizeContentPath } from './content-store.js';
import type { ResolvedLocaleConfig } from './site-config.js';

export type ResolvedRequestKind = 'markdown' | 'html' | 'asset' | 'not-found';

export interface ResolvedRequest {
  kind: ResolvedRequestKind;
  requestPath: string;
  sourcePath?: string;
}

export function resolveRequest(pathname: string): ResolvedRequest {
  const normalizedRequestPath = normalizeRequestPath(pathname);
  if (normalizedRequestPath === null) {
    return { kind: 'not-found', requestPath: pathname };
  }

  if (normalizedRequestPath === '/') {
    return {
      kind: 'html',
      requestPath: normalizedRequestPath,
      sourcePath: 'index.md',
    };
  }

  if (normalizedRequestPath.endsWith('/')) {
    const sourcePath = normalizeContentPath(
      `${normalizedRequestPath.slice(1)}index.md`,
    );
    return sourcePath === null
      ? { kind: 'not-found', requestPath: normalizedRequestPath }
      : {
          kind: 'html',
          requestPath: normalizedRequestPath,
          sourcePath,
        };
  }

  const relativePath = normalizedRequestPath.slice(1);
  const extension = path.posix.extname(relativePath).toLowerCase();

  if (extension === '.html') {
    const sourcePath = normalizeContentPath(
      `${relativePath.slice(0, -'.html'.length)}.md`,
    );
    return sourcePath === null
      ? { kind: 'not-found', requestPath: normalizedRequestPath }
      : {
          kind: 'html',
          requestPath: normalizedRequestPath,
          sourcePath,
        };
  }

  if (extension === '.md') {
    const sourcePath = normalizeContentPath(relativePath);
    return sourcePath === null
      ? { kind: 'not-found', requestPath: normalizedRequestPath }
      : {
          kind: 'markdown',
          requestPath: normalizedRequestPath,
          sourcePath,
        };
  }

  if (extension === '') {
    const sourcePath = normalizeContentPath(`${relativePath}.md`);
    return sourcePath === null
      ? { kind: 'not-found', requestPath: normalizedRequestPath }
      : {
          kind: 'html',
          requestPath: normalizedRequestPath,
          sourcePath,
        };
  }

  const sourcePath = normalizeContentPath(relativePath);
  return sourcePath === null
    ? { kind: 'not-found', requestPath: normalizedRequestPath }
    : {
        kind: 'asset',
        requestPath: normalizedRequestPath,
        sourcePath,
      };
}

export function normalizeRequestPath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname || '/');
    const collapsed = decoded.replace(/\/{2,}/g, '/');
    const absolute = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
    const segments = absolute.split('/');
    if (segments.some((segment) => segment === '..')) {
      return null;
    }
    const normalized = path.posix.normalize(absolute);

    const hasTrailingSlash =
      absolute.endsWith('/') && normalized !== '/' && !normalized.endsWith('/');
    return hasTrailingSlash ? `${normalized}/` : normalized;
  } catch {
    return null;
  }
}

/**
 * Attributes a request path to a configured content locale. Locale URL
 * prefixes map 1:1 to top-level `{code}` content directories, so attribution
 * never rewrites content resolution: a path that matches a locale prefix keeps
 * resolving to that locale's directory, and any other path belongs to the
 * default locale (whose content lives at the content root when unprefixed).
 */
export function matchRequestLocale(
  pathname: string,
  locales: readonly ResolvedLocaleConfig[] | undefined,
): ResolvedLocaleConfig | null {
  if (locales === undefined || locales.length === 0) {
    return null;
  }

  const normalized = normalizeRequestPath(pathname);
  if (normalized === null) {
    return null;
  }

  const prefixed = locales
    .filter((locale) => locale.pathPrefix !== '')
    .sort((left, right) => right.pathPrefix.length - left.pathPrefix.length);

  for (const locale of prefixed) {
    if (
      normalized === locale.pathPrefix ||
      normalized.startsWith(`${locale.pathPrefix}/`)
    ) {
      return locale;
    }
  }

  return locales.find((locale) => locale.isDefault) ?? null;
}
