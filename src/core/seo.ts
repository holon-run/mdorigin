/** Validated, representation-independent indexing and preview directives. */
export interface PageRobots {
  index?: boolean;
  follow?: boolean;
  maxSnippet?: number;
  maxImagePreview?: 'none' | 'standard' | 'large';
  maxVideoPreview?: number;
}

export interface RobotsRule {
  userAgent: string;
  allow?: string[];
  disallow?: string[];
}

export interface SiteRobots {
  rules: RobotsRule[];
}

export function normalizePageRobots(value: unknown): PageRobots | undefined {
  const result: PageRobots = {};
  if (typeof value === 'string') {
    for (const directive of value.toLowerCase().split(',').map((item) => item.trim())) {
      if (directive === 'noindex' || directive === 'none') result.index = false;
      if (directive === 'nofollow' || directive === 'none') result.follow = false;
      if (directive === 'index' || directive === 'all') result.index = true;
      if (directive === 'follow' || directive === 'all') result.follow = true;
      const [key, raw] = directive.split(':').map((item) => item.trim());
      if (key === 'max-snippet' && /^-?\d+$/.test(raw ?? '')) result.maxSnippet = Number(raw);
      if (key === 'max-video-preview' && /^-?\d+$/.test(raw ?? '')) result.maxVideoPreview = Number(raw);
      if (key === 'max-image-preview' && ['none', 'standard', 'large'].includes(raw)) {
        result.maxImagePreview = raw as PageRobots['maxImagePreview'];
      }
    }
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    if (typeof input.index === 'boolean') result.index = input.index;
    if (typeof input.follow === 'boolean') result.follow = input.follow;
    if (typeof input.maxSnippet === 'number') result.maxSnippet = input.maxSnippet;
    if (typeof input.maxVideoPreview === 'number') result.maxVideoPreview = input.maxVideoPreview;
    if (['none', 'standard', 'large'].includes(String(input.maxImagePreview))) {
      result.maxImagePreview = input.maxImagePreview as PageRobots['maxImagePreview'];
    }
  }
  for (const key of ['maxSnippet', 'maxVideoPreview'] as const) {
    if (!Number.isSafeInteger(result[key]) || result[key]! < -1) delete result[key];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function serializePageRobots(robots: PageRobots | undefined): string | undefined {
  if (!robots) return undefined;
  const parts: string[] = [];
  if (robots.index !== undefined) parts.push(robots.index ? 'index' : 'noindex');
  if (robots.follow !== undefined) parts.push(robots.follow ? 'follow' : 'nofollow');
  if (robots.maxSnippet !== undefined) parts.push(`max-snippet:${robots.maxSnippet}`);
  if (robots.maxImagePreview !== undefined) parts.push(`max-image-preview:${robots.maxImagePreview}`);
  if (robots.maxVideoPreview !== undefined) parts.push(`max-video-preview:${robots.maxVideoPreview}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** Only ISO calendar dates or timestamps with an explicit timezone are accepted. */
export function normalizeContentDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return undefined;
  const day = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return value.length === 10 ? value : new Date(timestamp).toISOString();
}

export function normalizeSiteRobots(value: unknown): SiteRobots | undefined {
  if (!value || typeof value !== 'object' || !('rules' in value) || !Array.isArray(value.rules)) {
    return undefined;
  }
  const line = (item: unknown): item is string =>
    typeof item === 'string' && item.length > 0 && !/[\r\n\u0000]/.test(item);
  const rules: RobotsRule[] = [];
  for (const rule of value.rules) {
    if (!rule || typeof rule !== 'object' || !line(rule.userAgent)) continue;
    rules.push({
      userAgent: rule.userAgent,
      allow: Array.isArray(rule.allow) ? rule.allow.filter(line) : [],
      disallow: Array.isArray(rule.disallow) ? rule.disallow.filter(line) : [],
    });
  }
  return { rules };
}

export function buildPageStructuredData(input: {
  title: string;
  description?: string;
  url?: string;
  siteTitle: string;
  siteUrl?: string;
  locale: string;
  type?: string;
  date?: string;
  updated?: string;
  author?: string | string[];
}): Record<string, unknown> {
  const authors = typeof input.author === 'string' ? [input.author] : input.author ?? [];
  return {
    '@context': 'https://schema.org',
    '@type': input.type === 'post' ? 'BlogPosting' : 'WebPage',
    name: input.title,
    ...(input.type === 'post' ? { headline: input.title } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.url ? { url: input.url, '@id': input.url } : {}),
    inLanguage: input.locale,
    ...(input.date ? { datePublished: input.date } : {}),
    ...(input.updated ? { dateModified: input.updated } : {}),
    ...(authors.length ? { author: authors.map((name) => ({ '@type': 'Person', name })) } : {}),
    isPartOf: {
      '@type': 'WebSite',
      name: input.siteTitle,
      ...(input.siteUrl ? { url: `${input.siteUrl}/` } : {}),
    },
  };
}
