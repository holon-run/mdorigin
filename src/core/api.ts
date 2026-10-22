import type { ResolvedSiteConfig } from './site-config.js';
import type { SearchApi, SearchHit } from '../search.js';

export interface ApiRouteOptions {
  searchApi?: SearchApi;
  siteConfig: ResolvedSiteConfig;
  requestUrl?: string;
  resolveCitation?: (hit: SearchHit) => Promise<string | undefined>;
}

export interface ApiRouteResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function handleApiRoute(
  pathname: string,
  searchParams: URLSearchParams | undefined,
  options: ApiRouteOptions,
): Promise<ApiRouteResponse | null> {
  if (pathname === '/api/openapi.json') {
    return json(200, buildOpenApiDocument(options));
  }

  if (pathname === '/api/search') {
    if (!options.searchApi) {
      return json(404, { error: 'search is not enabled for this site' });
    }

    const query = searchParams?.get('q')?.trim() ?? '';
    if (query === '') {
      return json(400, {
        error: 'missing required query parameter: q',
      });
    }

    const topK =
      normalizePositiveInteger(searchParams?.get('topK')) ??
      options.siteConfig.search?.topK ??
      10;
    const metadata = readSearchMetadataFilters(searchParams);
    const hits = await options.searchApi.search(query, {
      topK,
      metadata,
    });
    return json(200, {
      query,
      topK,
      metadata,
      count: hits.length,
      hits: await Promise.all(hits.map(async (hit) => serializeSearchHit(
        hit, await options.resolveCitation?.(hit),
      ))),
    });
  }

  return null;
}

function buildOpenApiDocument(options: ApiRouteOptions) {
  return {
    openapi: '3.1.0',
    info: {
      title: `${options.siteConfig.siteTitle} API`,
      version: '1.0.0',
      description: 'Search API for a mdorigin site.',
    },
    servers: options.siteConfig.siteUrl
      ? [{ url: options.siteConfig.siteUrl }]
      : options.requestUrl
        ? [{ url: new URL(options.requestUrl).origin }]
        : undefined,
    paths: {
      '/api/search': {
        get: {
          operationId: 'searchSite',
          summary: 'Search published site content',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Search query string.',
            },
            {
              name: 'topK',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, default: 10 },
              description: 'Maximum number of hits to return.',
            },
            {
              name: 'meta.<field>',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description:
                'Exact-match metadata filter. Use query parameters such as meta.type=post or meta.section=guides. Retrieval mode and reranking stay under site configuration.',
            },
          ],
          responses: {
            '200': {
              description: 'Search results.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['query', 'topK', 'count', 'hits'],
                    properties: {
                      query: { type: 'string' },
                      topK: { type: 'integer' },
                      metadata: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                      count: { type: 'integer' },
                      hits: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: [
                            'docId',
                            'relativePath',
                            'score',
                            'metadata',
                            'bestMatch',
                          ],
                          properties: {
                            docId: { type: 'string' },
                            relativePath: { type: 'string' },
                            canonicalUrl: { type: 'string' },
                            citationUrl: {
                              type: 'string',
                              description: 'A rendered heading URL when a source-offset mapping is available; canonicalUrl stays page-level.',
                            },
                            title: { type: 'string' },
                            summary: { type: 'string' },
                            score: { type: 'number' },
                            metadata: { type: 'object', additionalProperties: true },
                            bestMatch: {
                              type: 'object',
                              required: [
                                'chunkId',
                                'excerpt',
                                'headingPath',
                                'charStart',
                                'charEnd',
                                'score',
                              ],
                              properties: {
                                chunkId: { type: 'number' },
                                excerpt: { type: 'string' },
                                headingPath: {
                                  type: 'array',
                                  items: { type: 'string' },
                                },
                                charStart: { type: 'integer' },
                                charEnd: { type: 'integer' },
                                score: { type: 'number' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Invalid request.',
            },
            '404': {
              description: 'Search API not enabled.',
            },
          },
        },
      },
    },
  };
}

function readSearchMetadataFilters(
  searchParams: URLSearchParams | undefined,
): Record<string, string> | undefined {
  if (!searchParams) {
    return undefined;
  }

  const metadata: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (!key.startsWith('meta.') || value.trim() === '') {
      continue;
    }

    const metadataKey = key.slice('meta.'.length).trim();
    if (metadataKey === '') {
      continue;
    }

    metadata[metadataKey] = value;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function serializeSearchHit(hit: SearchHit, citationUrl?: string) {
  return {
    docId: hit.docId,
    relativePath: hit.relativePath,
    canonicalUrl: hit.canonicalUrl,
    ...(citationUrl ? { citationUrl } : {}),
    title: hit.title,
    summary: hit.summary,
    metadata: hit.metadata,
    score: hit.score,
    bestMatch: hit.bestMatch,
  };
}

function normalizePositiveInteger(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function json(status: number, body: unknown): ApiRouteResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body, null, 2),
  };
}
