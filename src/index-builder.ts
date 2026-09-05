import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { applyIndexTransforms, type MdoPlugin } from './core/extensions.js';
import { isIgnoredContentName } from './core/content-store.js';
import { inferDirectoryContentType } from './core/content-type.js';
import { getDirectoryIndexCandidates } from './core/directory-index.js';
import {
  getDocumentSummary,
  getDocumentTitle,
  parseMarkdownDocument,
  type ManagedIndexEntry,
} from './core/markdown.js';

const INDEX_START_MARKER = '<!-- INDEX:START -->';
const INDEX_END_MARKER = '<!-- INDEX:END -->';

interface ArticleIndexEntry {
  title: string;
  date?: string;
  summary?: string;
  link: string;
  order?: number;
}

interface DirectoryIndexEntry {
  title: string;
  link: string;
  order?: number;
}

interface ResolvedDirectoryEntry {
  title: string;
  type: 'page' | 'post';
  date?: string;
  summary?: string;
  draft: boolean;
  order?: number;
}

export interface BuildIndexOptions {
  rootDir?: string;
  dir?: string;
  plugins?: MdoPlugin[];
  /** Top-level directory names (locale content bases) kept out of managed indexes. */
  excludedDirectories?: string[];
}

export interface BuildIndexResult {
  updatedFiles: string[];
  skippedDirectories: string[];
}

export async function buildDirectoryIndexes(
  options: BuildIndexOptions,
): Promise<BuildIndexResult> {
  if (!options.rootDir && !options.dir) {
    throw new Error('Expected either rootDir or dir.');
  }

  if (options.rootDir && options.dir) {
    throw new Error('Use either rootDir or dir, not both.');
  }

  if (options.dir) {
    const directoryPath = path.resolve(options.dir);
    const updatedFile = await updateSingleDirectoryIndex(directoryPath, {
      createIfMissing: false,
      plugins: options.plugins ?? [],
      excludedDirectories: options.excludedDirectories,
    });
    return {
      updatedFiles: updatedFile ? [updatedFile] : [],
      skippedDirectories: updatedFile ? [] : [directoryPath],
    };
  }

  const rootDir = path.resolve(options.rootDir!);
  const directories = await listDirectoriesRecursively(rootDir);
  const updatedFiles: string[] = [];
  const skippedDirectories: string[] = [];

  for (const directoryPath of directories) {
    const updatedFile = await updateSingleDirectoryIndex(directoryPath, {
      createIfMissing: false,
      plugins: options.plugins ?? [],
      excludedDirectories: options.excludedDirectories,
    });
    if (updatedFile) {
      updatedFiles.push(updatedFile);
      continue;
    }

    skippedDirectories.push(directoryPath);
  }

  return { updatedFiles, skippedDirectories };
}

interface UpdateSingleDirectoryIndexOptions {
  createIfMissing: boolean;
  plugins: MdoPlugin[];
  excludedDirectories?: string[];
}

async function updateSingleDirectoryIndex(
  directoryPath: string,
  options: UpdateSingleDirectoryIndexOptions,
): Promise<string | null> {
  const indexFilePath = await resolveDirectoryIndexFile(directoryPath);
  if (indexFilePath === null && !options.createIfMissing) {
    return null;
  }

  if (indexFilePath !== null) {
    const source = await readFile(indexFilePath, 'utf8');
    const parsed = await parseMarkdownDocument(path.basename(indexFilePath), source);
    const shape = await inspectDirectoryShape(directoryPath);
    if (inferDirectoryContentType(parsed.meta, shape) === 'post') {
      return null;
    }
  }

  const targetFilePath = indexFilePath ?? path.join(directoryPath, 'index.md');
  const existingContent = indexFilePath
    ? await readFile(indexFilePath, 'utf8')
    : '';
  const block = await buildManagedIndexBlock(
    directoryPath,
    options.plugins,
    options.excludedDirectories,
  );
  const nextContent = upsertManagedIndexBlock(existingContent, block, {
    directoryPath,
  });

  if (nextContent !== existingContent) {
    await writeFile(targetFilePath, nextContent, 'utf8');
  }

  return targetFilePath;
}

export async function buildManagedIndexBlock(
  directoryPath: string,
  plugins: MdoPlugin[] = [],
  excludedDirectories?: string[],
): Promise<string> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const directories: DirectoryIndexEntry[] = [];
  const articles: ArticleIndexEntry[] = [];
  const excluded = new Set(excludedDirectories ?? []);

  for (const entry of entries) {
    if (isIgnoredContentName(entry.name)) {
      continue;
    }

    const fullPath = path.join(directoryPath, entry.name);
    const entryStats = await stat(fullPath);
    if (entryStats.isDirectory()) {
      if (excluded.has(entry.name)) {
        continue;
      }
      if (!(await hasMeaningfulDirectoryContent(fullPath))) {
        continue;
      }

      const resolvedEntry = await resolveDirectoryEntry(fullPath, entry.name);
      if (resolvedEntry.draft) {
        continue;
      }

      if (resolvedEntry.type === 'post') {
        articles.push({
          title: resolvedEntry.title,
          date: resolvedEntry.date,
          summary: resolvedEntry.summary,
          link: `./${entry.name}/`,
          order: resolvedEntry.order,
        });
      } else {
        directories.push({
          title: resolvedEntry.title,
          link: `./${entry.name}/`,
          order: resolvedEntry.order,
        });
      }
      continue;
    }

    if (!entryStats.isFile() || path.extname(entry.name).toLowerCase() !== '.md') {
      continue;
    }

    if (entry.name === 'index.md' || entry.name === 'README.md') {
      continue;
    }

    const source = await readFile(fullPath, 'utf8');
    const parsed = await parseMarkdownDocument(entry.name, source);
    if (parsed.meta.draft === true) {
      continue;
    }

    articles.push({
      title: getDocumentTitle(
        parsed.meta,
        parsed.body,
        entry.name.slice(0, -'.md'.length),
      ),
      date: parsed.meta.date,
      summary: getDocumentSummary(parsed.meta, parsed.body),
      link: `./${entry.name}`,
      order: parsed.meta.order,
    });
  }

  directories.sort(compareDirectories);
  articles.sort(compareArticles);

  const transformedEntries = await applyIndexTransforms(
    [
      ...directories.map(
        (entry): ManagedIndexEntry => ({
          kind: 'directory',
          title: entry.title,
          href: entry.link,
        }),
      ),
      ...articles.map(
        (entry): ManagedIndexEntry => ({
          kind: 'article',
          title: entry.title,
          href: entry.link,
          detail: [entry.date, entry.summary].filter(Boolean).join(' · ') || undefined,
        }),
      ),
    ],
    plugins,
    {
      mode: 'build',
      directoryPath,
    },
  );

  return renderManagedIndexBlock(transformedEntries);
}

export function upsertManagedIndexBlock(
  source: string,
  block: string,
  options: { directoryPath?: string } = {},
): string {
  const hasStart = source.includes(INDEX_START_MARKER);
  const hasEnd = source.includes(INDEX_END_MARKER);

  if (hasStart !== hasEnd) {
    const scope = options.directoryPath ? ` in ${options.directoryPath}` : '';
    throw new Error(`Found only one index marker${scope}.`);
  }

  if (hasStart && hasEnd) {
    const pattern = new RegExp(
      `${escapeRegExp(INDEX_START_MARKER)}[\\s\\S]*?${escapeRegExp(INDEX_END_MARKER)}`,
      'm',
    );
    return source.replace(pattern, block);
  }

  const trimmed = source.trimEnd();
  if (trimmed === '') {
    return `${block}\n`;
  }

  return `${trimmed}\n\n${block}\n`;
}

function renderManagedIndexBlock(entries: ManagedIndexEntry[]): string {
  const lines = [INDEX_START_MARKER, ''];

  if (entries.length > 0) {
    for (const entry of entries) {
      lines.push(`- [${entry.title}](${entry.href})`);
      if (entry.detail) {
        lines.push(`  ${entry.detail}`);
      }
      lines.push(`  <!-- mdorigin:index kind=${entry.kind} -->`);
      lines.push('');
    }
  }

  lines.push(INDEX_END_MARKER);
  return lines.join('\n');
}

async function resolveDirectoryEntry(
  directoryPath: string,
  fallbackName: string,
): Promise<ResolvedDirectoryEntry> {
  const indexPath = await resolveDirectoryIndexFile(directoryPath);
  if (indexPath === null) {
    return {
      title: fallbackName,
      type: 'page',
      draft: false,
    };
  }

  const source = await readFile(indexPath, 'utf8');
  const parsed = await parseMarkdownDocument(path.basename(indexPath), source);
  const shape = await inspectDirectoryShape(directoryPath);

  return {
    title: getDocumentTitle(parsed.meta, parsed.body, fallbackName),
    type: inferDirectoryContentType(parsed.meta, shape),
    date: parsed.meta.date,
    summary: getDocumentSummary(parsed.meta, parsed.body),
    draft: parsed.meta.draft === true,
    order: parsed.meta.order,
  };
}

async function listDirectoriesRecursively(rootDir: string): Promise<string[]> {
  return listDirectoriesRecursivelyInternal(rootDir, new Set<string>());
}

async function listDirectoriesRecursivelyInternal(
  rootDir: string,
  visitedRealDirectories: Set<string>,
): Promise<string[]> {
  const realDirectoryPath = await realpath(rootDir);
  if (visitedRealDirectories.has(realDirectoryPath)) {
    return [];
  }
  visitedRealDirectories.add(realDirectoryPath);

  const directories = [rootDir];
  const entries = await readdir(rootDir, { withFileTypes: true });
  const rootShape = await inspectDirectoryShape(rootDir);

  for (const entry of entries) {
    if (isIgnoredContentName(entry.name)) {
      continue;
    }

    if (rootShape.hasSkillIndex && isIgnoredSkillSupportDirectory(entry.name)) {
      continue;
    }

    const childPath = path.join(rootDir, entry.name);
    const childStats = await stat(childPath);
    if (!childStats.isDirectory()) {
      continue;
    }

    if (!(await hasMeaningfulDirectoryContent(childPath))) {
      continue;
    }

    directories.push(childPath);

    const childIndexPath = await resolveDirectoryIndexFile(childPath);
    if (childIndexPath !== null) {
      const source = await readFile(childIndexPath, 'utf8');
      const parsed = await parseMarkdownDocument(path.basename(childIndexPath), source);
      const shape = await inspectDirectoryShape(childPath);
      if (inferDirectoryContentType(parsed.meta, shape) === 'post') {
        continue;
      }
    }

    directories.push(
      ...(await listDirectoriesRecursivelyInternal(
        childPath,
        visitedRealDirectories,
      )).slice(1),
    );
  }

  return directories;
}

async function hasMeaningfulDirectoryContent(
  directoryPath: string,
  visitedRealDirectories: Set<string> = new Set(),
): Promise<boolean> {
  const realDirectoryPath = await realpath(directoryPath);
  if (visitedRealDirectories.has(realDirectoryPath)) {
    return false;
  }
  visitedRealDirectories.add(realDirectoryPath);

  const shape = await inspectDirectoryShape(directoryPath);
  const indexPath = await resolveDirectoryIndexFile(directoryPath);
  if (
    indexPath !== null ||
    shape.hasExtraMarkdownFiles ||
    shape.hasAssetFiles ||
    shape.hasSkillIndex
  ) {
    return true;
  }

  if (!shape.hasChildDirectories) {
    return false;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (isIgnoredContentName(entry.name)) {
      continue;
    }

    if (shape.hasSkillIndex && isIgnoredSkillSupportDirectory(entry.name)) {
      continue;
    }

    const childPath = path.join(directoryPath, entry.name);
    const childStats = await stat(childPath);
    if (!childStats.isDirectory()) {
      continue;
    }

    if (await hasMeaningfulDirectoryContent(childPath, visitedRealDirectories)) {
      return true;
    }
  }

  return false;
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

    const fullPath = path.join(directoryPath, entry.name);
    const entryStats = await stat(fullPath);

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

function compareDirectories(left: DirectoryIndexEntry, right: DirectoryIndexEntry): number {
  const orderComparison = compareOptionalOrder(left.order, right.order);
  if (orderComparison !== 0) {
    return orderComparison;
  }

  return left.title.localeCompare(right.title);
}

function compareArticles(left: ArticleIndexEntry, right: ArticleIndexEntry): number {
  const orderComparison = compareOptionalOrder(left.order, right.order);
  if (orderComparison !== 0) {
    return orderComparison;
  }

  const leftTimestamp = left.date ? Date.parse(left.date) : Number.NaN;
  const rightTimestamp = right.date ? Date.parse(right.date) : Number.NaN;

  if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp)) {
    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }
  } else if (!Number.isNaN(leftTimestamp)) {
    return -1;
  } else if (!Number.isNaN(rightTimestamp)) {
    return 1;
  }

  return left.title.localeCompare(right.title);
}

function compareOptionalOrder(
  leftOrder: number | undefined,
  rightOrder: number | undefined,
): number {
  if (leftOrder !== undefined && rightOrder !== undefined) {
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return 0;
  }

  if (leftOrder !== undefined) {
    return -1;
  }

  if (rightOrder !== undefined) {
    return 1;
  }

  return 0;
}

async function resolveDirectoryIndexFile(
  directoryPath: string,
): Promise<string | null> {
  for (const candidate of getDirectoryIndexCandidates('')) {
    const candidatePath = path.join(directoryPath, candidate);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function isIgnoredSkillSupportDirectory(name: string): boolean {
  return (
    name === 'scripts' ||
    name === 'references' ||
    name === 'assets' ||
    name === 'templates'
  );
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
