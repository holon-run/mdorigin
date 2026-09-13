import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ContentEntry, ContentStore } from '../core/content-store.js';
import {
  getMediaTypeForPath,
  isIgnoredContentName,
  isLikelyTextPath,
  normalizeContentPath,
  normalizeDirectoryPath,
  type ContentDirectoryEntry,
} from '../core/content-store.js';
import type { MdoPlugin } from '../core/extensions.js';
import { handleSiteRequest } from '../core/request-handler.js';
import type { ResolvedSiteConfig } from '../core/site-config.js';
import type { SearchApi } from '../search.js';

export interface NodeAdapterOptions {
  rootDir: string;
  draftMode: 'include' | 'exclude';
  siteConfig: ResolvedSiteConfig;
  searchApi?: SearchApi;
  plugins?: MdoPlugin[];
}

export function createFileSystemContentStore(rootDir: string): ContentStore {
  const resolvedRootDir = path.resolve(rootDir);

  return {
    async get(contentPath: string): Promise<ContentEntry | null> {
      const normalizedPath = normalizeContentPath(contentPath);
      if (normalizedPath === null) {
        return null;
      }

      const filePath = path.resolve(resolvedRootDir, normalizedPath);
      if (!isVisiblePathWithinRoot(resolvedRootDir, filePath)) {
        return null;
      }

      try {
        const fileStats = await stat(filePath);
        if (!fileStats.isFile()) {
          return null;
        }

        const mediaType = getMediaTypeForPath(normalizedPath);
        if (isLikelyTextPath(normalizedPath)) {
          const text = await readFile(filePath, 'utf8');
          return {
            path: normalizedPath,
            kind: 'text',
            mediaType,
            text,
          };
        }

        const bytes = new Uint8Array(await readFile(filePath));
        return {
          path: normalizedPath,
          kind: 'binary',
          mediaType,
          bytes,
        };
      } catch (error) {
        if (isNodeNotFound(error)) {
          return null;
        }

        throw error;
      }
    },
    async listDirectory(contentPath: string): Promise<ContentDirectoryEntry[] | null> {
      const normalizedPath = normalizeDirectoryPath(contentPath);
      if (normalizedPath === null) {
        return null;
      }

      const directoryPath = path.resolve(resolvedRootDir, normalizedPath);
      if (!isVisiblePathWithinRoot(resolvedRootDir, directoryPath)) {
        return null;
      }

      try {
        const directoryStats = await stat(directoryPath);
        if (!directoryStats.isDirectory()) {
          return null;
        }

        const entries = await readdir(directoryPath, { withFileTypes: true });
        const resolvedEntries = await Promise.all(
          entries
            .filter((entry) => !isIgnoredContentName(entry.name))
            .map(async (entry): Promise<ContentDirectoryEntry | null> => {
              const childVisiblePath =
                normalizedPath === ''
                  ? entry.name
                  : `${normalizedPath}/${entry.name}`;
              const childFilePath = path.resolve(resolvedRootDir, childVisiblePath);

              try {
                const childStats = await stat(childFilePath);
                if (childStats.isDirectory()) {
                  return {
                    name: entry.name,
                    path: childVisiblePath,
                    kind: 'directory',
                  };
                }

                if (childStats.isFile()) {
                  return {
                    name: entry.name,
                    path: childVisiblePath,
                    kind: 'file',
                  };
                }
              } catch (error) {
                if (isNodeNotFound(error)) {
                  return null;
                }

                throw error;
              }

              return null;
            }),
        );

        return resolvedEntries
          .filter((entry): entry is ContentDirectoryEntry => entry !== null)
          .sort((left, right) => {
            if (left.kind !== right.kind) {
              return left.kind === 'directory' ? -1 : 1;
            }

            return left.name.localeCompare(right.name);
          });
      } catch (error) {
        if (isNodeNotFound(error)) {
          return null;
        }

        throw error;
      }
    },
  };
}

function isVisiblePathWithinRoot(rootDir: string, candidatePath: string): boolean {
  return (
    candidatePath === rootDir ||
    candidatePath.startsWith(`${rootDir}${path.sep}`)
  );
}

export function createNodeRequestListener(options: NodeAdapterOptions) {
  const store = createFileSystemContentStore(options.rootDir);

  return async function onRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const siteResponse = await handleSiteRequest(store, url.pathname, {
        draftMode: options.draftMode,
        siteConfig: options.siteConfig,
        acceptHeader: request.headers.accept,
        acceptLanguageHeader: request.headers['accept-language'],
        cookieHeader: request.headers.cookie,
        userAgentHeader: request.headers['user-agent'],
        searchParams: url.searchParams,
        requestUrl: url.toString(),
        searchApi: options.searchApi,
        plugins: options.plugins,
      });

      response.statusCode = siteResponse.status;
      for (const [headerName, headerValue] of Object.entries(siteResponse.headers)) {
        response.setHeader(headerName, headerValue);
      }

      if (siteResponse.body instanceof Uint8Array) {
        response.end(Buffer.from(siteResponse.body));
        return;
      }

      response.end(siteResponse.body ?? '');
    } catch (error) {
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end(
        error instanceof Error ? error.message : 'Unexpected server error',
      );
    }
  };
}

export function createNodeServer(options: NodeAdapterOptions) {
  return createServer(createNodeRequestListener(options));
}

function isNodeNotFound(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
