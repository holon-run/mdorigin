import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type {
  CloudflareBundleRuntimeConfig,
  CloudflareManifest,
  CloudflareManifestEntry,
  ExternalBinaryCloudflareManifestEntry,
} from './adapters/cloudflare.js';
import { createCloudflareWorker } from './adapters/cloudflare.js';
import {
  getMediaTypeForPath,
  isIgnoredContentName,
  isLikelyTextPath,
  normalizeContentPath,
} from './core/content-store.js';
import type { ResolvedSiteConfig } from './core/site-config.js';
import type { ExternalSearchBundleEntry } from './search.js';

export { createCloudflareWorker };
export type {
  CloudflareBundleRuntimeConfig,
  CloudflareManifest,
  CloudflareManifestEntry,
};

export type CloudflareBinaryMode = 'inline' | 'external';

export interface BuildCloudflareManifestOptions {
  rootDir: string;
  siteConfig: ResolvedSiteConfig;
  searchDir?: string;
  binaryMode?: CloudflareBinaryMode;
  assetsMaxBytes?: number;
  r2Binding?: string;
}

export interface WriteCloudflareBundleOptions extends BuildCloudflareManifestOptions {
  outDir: string;
  packageImport?: string;
  configModulePath?: string;
}

export interface CloudflareBundleMetadata {
  version: 2;
  workerEntry: string;
  binaryMode: CloudflareBinaryMode;
  assetsMaxBytes?: number;
  assetsDir?: string;
  r2Dir?: string;
  r2Binding?: string;
  siteTitle?: string;
  stagedObjects: Array<{
    kind: 'binary' | 'search';
    path: string;
    mediaType: string;
    storageKind: 'assets' | 'r2';
    storageKey: string;
    file: string;
    byteSize: number;
  }>;
}

export interface InitCloudflareProjectOptions {
  projectDir: string;
  workerEntry: string;
  workerName?: string;
  siteTitle?: string;
  compatibilityDate?: string;
  r2Bucket?: string;
  force?: boolean;
}

export interface SyncCloudflareR2Options {
  dir: string;
  bucketName: string;
  force?: boolean;
  runCommand?: typeof runWranglerCommand;
}

export interface SyncCloudflareR2Result {
  uploadedCount: number;
  skippedCount: number;
  stateFile: string;
}

interface CloudflareR2SyncState {
  version: 1;
  uploaded: Record<string, { syncedAt: string }>;
}

interface CloudflareBundleMetadataV1 {
  version?: 1;
  workerEntry: string;
  binaryMode: CloudflareBinaryMode;
  assetsMaxBytes?: number;
  assetsDir?: string;
  r2Dir?: string;
  r2Binding?: string;
  siteTitle?: string;
  r2Objects?: Array<{
    path: string;
    mediaType: string;
    storageKey: string;
    file: string;
    byteSize: number;
  }>;
}

const DEFAULT_ASSETS_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_ASSETS_BINDING = 'ASSETS';
const DEFAULT_R2_BINDING = 'MDORIGIN_R2';
const BUNDLE_FILE_NAME = 'bundle.json';
const R2_STATE_FILE_NAME = 'r2-sync-state.json';
const SEARCH_ASSETS_PREFIX = '__mdorigin/search';

export async function buildCloudflareManifest(
  options: BuildCloudflareManifestOptions,
): Promise<CloudflareManifest> {
  const rootDir = path.resolve(options.rootDir);
  const files = await listFiles(rootDir);
  const entries: CloudflareManifestEntry[] = [];
  const binaryMode = options.binaryMode ?? 'inline';
  const assetsMaxBytes = options.assetsMaxBytes ?? DEFAULT_ASSETS_MAX_BYTES;
  const r2Binding = options.r2Binding ?? DEFAULT_R2_BINDING;

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath).replaceAll(path.sep, '/');
    const normalizedPath = normalizeContentPath(relativePath);
    if (normalizedPath === null) {
      continue;
    }

    const mediaType = getMediaTypeForPath(normalizedPath);
    if (isLikelyTextPath(normalizedPath)) {
      entries.push({
        path: normalizedPath,
        kind: 'text',
        mediaType,
        text: await readFile(filePath, 'utf8'),
      });
      continue;
    }

    if (binaryMode === 'inline') {
      const bytes = await readFile(filePath);
      entries.push({
        path: normalizedPath,
        kind: 'binary',
        mediaType,
        base64: bytes.toString('base64'),
      });
      continue;
    }

    const fileStats = await stat(filePath);
    entries.push(
      await buildExternalBinaryEntry(filePath, normalizedPath, mediaType, fileStats.size, {
        assetsMaxBytes,
        r2Binding,
      }),
    );
  }

  const externalSearchEntries = options.searchDir
    ? await buildSearchBundleEntries(path.resolve(options.searchDir), assetsMaxBytes)
    : undefined;

  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    entries,
    siteConfig: options.siteConfig,
    externalSearchEntries,
    runtime:
      binaryMode === 'external' || (externalSearchEntries?.length ?? 0) > 0
        ? {
            binaryMode,
            r2Binding,
          }
        : {
            binaryMode,
          },
  };
}

export async function writeCloudflareBundle(
  options: WriteCloudflareBundleOptions,
): Promise<{ manifest: CloudflareManifest; workerFile: string; bundleFile: string }> {
  const outDir = path.resolve(options.outDir);
  const binaryMode = options.binaryMode ?? 'inline';
  const assetsMaxBytes = options.assetsMaxBytes ?? DEFAULT_ASSETS_MAX_BYTES;
  const r2Binding = options.r2Binding ?? DEFAULT_R2_BINDING;
  const manifest = await buildCloudflareManifest({
    rootDir: options.rootDir,
    siteConfig: options.siteConfig,
    searchDir: options.searchDir,
    binaryMode,
    assetsMaxBytes,
    r2Binding,
  });
  // Deploy version = hash of the manifest payload (all entries, config, and
  // search bundle references). Workers use it as a strong ETag so content
  // edits produce a new version and invalidate every cached response.
  manifest.deployVersion = createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex')
    .slice(0, 16);
  const packageImport = options.packageImport ?? 'mdorigin/cloudflare-runtime';
  const workerFile = path.join(outDir, 'worker.mjs');
  const bundleFile = path.join(outDir, BUNDLE_FILE_NAME);
  const configImportPath = options.configModulePath
    ? toPosixPath(path.relative(outDir, options.configModulePath))
    : null;
  const workerSource = [
    `import { createCloudflareWorker } from '${packageImport}';`,
    configImportPath
      ? `import * as userConfigModule from '${configImportPath.startsWith('.') ? configImportPath : `./${configImportPath}`}';`
      : '',
    '',
    `const manifest = ${JSON.stringify(manifest, null, 2)};`,
    '',
    configImportPath
      ? [
          'function unwrapUserConfigModule(moduleValue) {',
          '  let current = moduleValue;',
          "  while (current && typeof current === 'object' && 'default' in current && current.default !== undefined) {",
          '    current = current.default;',
          '  }',
          "  if (current && typeof current === 'object' && 'config' in current && current.config !== undefined) {",
          '    return current.config;',
          '  }',
          '  return current;',
          '}',
          '',
          'const userConfig = unwrapUserConfigModule(userConfigModule);',
          '',
        ].join('\n')
      : '',
    configImportPath
      ? 'export default createCloudflareWorker(manifest, { plugins: Array.isArray(userConfig?.plugins) ? userConfig.plugins : [] });'
      : 'export default createCloudflareWorker(manifest);',
    '',
  ].join('\n');

  await mkdir(outDir, { recursive: true });
  const metadata = await writeExternalStaging(
    path.resolve(options.rootDir),
    options.searchDir ? path.resolve(options.searchDir) : undefined,
    outDir,
    manifest,
    {
      binaryMode,
      assetsMaxBytes,
      r2Binding,
      siteTitle: options.siteConfig.siteTitle,
    },
  );
  await writeFile(workerFile, workerSource, 'utf8');
  await writeFile(bundleFile, JSON.stringify(metadata, null, 2), 'utf8');

  return {
    manifest,
    workerFile,
    bundleFile,
  };
}

export async function initCloudflareProject(
  options: InitCloudflareProjectOptions,
): Promise<{ configFile: string }> {
  const projectDir = path.resolve(options.projectDir);
  const configFile = path.join(projectDir, 'wrangler.jsonc');
  const existing = await pathExists(configFile);
  if (existing && !options.force) {
    throw new Error(
      `Refusing to overwrite ${configFile}. Re-run with --force to replace it.`,
    );
  }

  const bundleMetadata = await readCloudflareBundleMetadata(options.workerEntry);
  if (
    bundleMetadata &&
    bundleMetadata.stagedObjects.some((object) => object.storageKind === 'r2') &&
    !options.r2Bucket
  ) {
    throw new Error(
      'Cloudflare bundle contains R2-backed staged objects. Re-run init cloudflare with --r2-bucket <bucket-name>.',
    );
  }

  const workerName =
    options.workerName ??
    slugifyWorkerName(bundleMetadata?.siteTitle ?? options.siteTitle) ??
    'mdorigin-site';
  const compatibilityDate = options.compatibilityDate ?? '2026-03-20';
  const wranglerConfig = [
    '{',
    '  "$schema": "./node_modules/wrangler/config-schema.json",',
    `  "name": ${JSON.stringify(workerName)},`,
    `  "main": ${JSON.stringify(toPosixPath(path.relative(projectDir, options.workerEntry)))},`,
    `  "compatibility_date": ${JSON.stringify(compatibilityDate)},`,
    '  "compatibility_flags": ["nodejs_compat"]',
    bundleMetadata?.assetsDir
      ? [
          ',',
          '  "assets": {',
          `    "directory": ${JSON.stringify(toPosixPath(path.relative(projectDir, path.join(path.dirname(options.workerEntry), bundleMetadata.assetsDir))))},`,
          `    "binding": ${JSON.stringify(DEFAULT_ASSETS_BINDING)},`,
          '    "run_worker_first": false,',
          '    "html_handling": "none",',
          '    "not_found_handling": "none"',
          '  }',
        ].join('\n')
      : '',
    bundleMetadata &&
    bundleMetadata.stagedObjects.some((object) => object.storageKind === 'r2') &&
    bundleMetadata.r2Binding &&
    options.r2Bucket
      ? [
          ',',
          '  "r2_buckets": [',
          '    {',
          `      "binding": ${JSON.stringify(bundleMetadata.r2Binding)},`,
          `      "bucket_name": ${JSON.stringify(options.r2Bucket)}`,
          '    }',
          '  ]',
        ].join('\n')
      : '',
    '}',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  await mkdir(projectDir, { recursive: true });
  await writeFile(configFile, wranglerConfig, 'utf8');

  return { configFile };
}

export async function syncCloudflareR2(
  options: SyncCloudflareR2Options,
): Promise<SyncCloudflareR2Result> {
  const outDir = path.resolve(options.dir);
  const bundleFile = path.join(outDir, BUNDLE_FILE_NAME);
  const metadata = await readBundleMetadataFile(bundleFile);
  const r2Objects = metadata.stagedObjects.filter(
    (object) => object.storageKind === 'r2',
  );
  if (r2Objects.length === 0) {
    throw new Error(`No R2-backed staged objects found in ${bundleFile}.`);
  }

  const stateFile = path.join(outDir, R2_STATE_FILE_NAME);
  const state = await readR2SyncState(stateFile);
  const runCommand = options.runCommand ?? runWranglerCommand;
  let uploadedCount = 0;
  let skippedCount = 0;

  for (const object of r2Objects) {
    const stateKey = `${options.bucketName}:${object.storageKey}`;
    if (!options.force && state.uploaded[stateKey]) {
      skippedCount += 1;
      continue;
    }

    const filePath = path.join(outDir, object.file);
    const result = runCommand('wrangler', [
      'r2',
      'object',
      'put',
      `${options.bucketName}/${object.storageKey}`,
      '--file',
      filePath,
      '--content-type',
      object.mediaType,
      '--remote',
    ]);
    if (result.status !== 0) {
      throw new Error(result.stderr || `Failed to upload R2 object ${object.storageKey}.`);
    }

    state.uploaded[stateKey] = {
      syncedAt: new Date().toISOString(),
    };
    uploadedCount += 1;
  }

  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  return {
    uploadedCount,
    skippedCount,
    stateFile,
  };
}

async function buildExternalBinaryEntry(
  filePath: string,
  normalizedPath: string,
  mediaType: string,
  byteSize: number,
  options: { assetsMaxBytes: number; r2Binding: string },
): Promise<ExternalBinaryCloudflareManifestEntry> {
  if (byteSize <= options.assetsMaxBytes) {
    return {
      path: normalizedPath,
      kind: 'binary',
      mediaType,
      storageKind: 'assets',
      storageKey: normalizedPath,
      byteSize,
    };
  }

  return {
    path: normalizedPath,
    kind: 'binary',
    mediaType,
    storageKind: 'r2',
    storageKey: await buildR2StorageKey(filePath, normalizedPath),
    byteSize,
  };
}

async function writeExternalStaging(
  rootDir: string,
  searchDir: string | undefined,
  outDir: string,
  manifest: CloudflareManifest,
  options: {
    binaryMode: CloudflareBinaryMode;
    assetsMaxBytes: number;
    r2Binding: string;
    siteTitle?: string;
  },
): Promise<CloudflareBundleMetadata> {
  const assetsDir = path.join(outDir, 'assets');
  const r2Dir = path.join(outDir, 'r2');
  await rm(assetsDir, { recursive: true, force: true });
  await rm(r2Dir, { recursive: true, force: true });

  const stagedObjects = new Map<
    string,
    CloudflareBundleMetadata['stagedObjects'][number]
  >();
  let hasAssets = false;
  let hasR2 = false;
  if (options.binaryMode === 'external') {
    for (const entry of manifest.entries) {
      if (entry.kind !== 'binary' || !('storageKind' in entry)) {
        continue;
      }

      const sourceFile = path.resolve(rootDir, entry.path);
      if (entry.storageKind === 'assets') {
        const targetFile = path.join(assetsDir, entry.storageKey);
        await mkdir(path.dirname(targetFile), { recursive: true });
        await copyFile(sourceFile, targetFile);
        hasAssets = true;
        stagedObjects.set(`assets:${entry.storageKey}`, {
          kind: 'binary',
          path: entry.path,
          mediaType: entry.mediaType,
          storageKind: 'assets',
          storageKey: entry.storageKey,
          file: toPosixPath(path.join('assets', entry.storageKey)),
          byteSize: entry.byteSize,
        });
        continue;
      }

      const relativeFile = toPosixPath(path.join('r2', entry.storageKey));
      const targetFile = path.join(outDir, relativeFile);
      if (!stagedObjects.has(`r2:${entry.storageKey}`)) {
        await mkdir(path.dirname(targetFile), { recursive: true });
        await copyFile(sourceFile, targetFile);
        hasR2 = true;
        stagedObjects.set(`r2:${entry.storageKey}`, {
          kind: 'binary',
          path: entry.path,
          mediaType: entry.mediaType,
          storageKind: 'r2',
          storageKey: entry.storageKey,
          file: relativeFile,
          byteSize: entry.byteSize,
        });
      }
    }
  }

  if (searchDir && manifest.externalSearchEntries) {
    for (const entry of manifest.externalSearchEntries) {
      const sourceFile = path.join(searchDir, entry.path);
      if (entry.storageKind === 'assets') {
        const targetFile = path.join(assetsDir, entry.storageKey);
        await mkdir(path.dirname(targetFile), { recursive: true });
        await copyFile(sourceFile, targetFile);
        hasAssets = true;
        stagedObjects.set(`assets:${entry.storageKey}`, {
          kind: 'search',
          path: entry.path,
          mediaType: entry.mediaType,
          storageKind: 'assets',
          storageKey: entry.storageKey,
          file: toPosixPath(path.join('assets', entry.storageKey)),
          byteSize: entry.byteSize,
        });
        continue;
      }

      const relativeFile = toPosixPath(path.join('r2', entry.storageKey));
      const targetFile = path.join(outDir, relativeFile);
      if (!stagedObjects.has(`r2:${entry.storageKey}`)) {
        await mkdir(path.dirname(targetFile), { recursive: true });
        await copyFile(sourceFile, targetFile);
        hasR2 = true;
        stagedObjects.set(`r2:${entry.storageKey}`, {
          kind: 'search',
          path: entry.path,
          mediaType: entry.mediaType,
          storageKind: 'r2',
          storageKey: entry.storageKey,
          file: relativeFile,
          byteSize: entry.byteSize,
        });
      }
    }
  }

  return {
    version: 2,
    workerEntry: 'worker.mjs',
    binaryMode: options.binaryMode,
    assetsMaxBytes:
      options.binaryMode === 'external' || searchDir ? options.assetsMaxBytes : undefined,
    assetsDir: hasAssets ? 'assets' : undefined,
    r2Dir: hasR2 ? 'r2' : undefined,
    r2Binding: hasR2 ? options.r2Binding : undefined,
    siteTitle: options.siteTitle,
    stagedObjects: Array.from(stagedObjects.values()).sort((left, right) =>
      left.storageKey.localeCompare(right.storageKey),
    ),
  };
}

async function readCloudflareBundleMetadata(
  workerEntry: string,
): Promise<CloudflareBundleMetadata | null> {
  const bundleFile = path.join(path.dirname(workerEntry), BUNDLE_FILE_NAME);
  if (!(await pathExists(bundleFile))) {
    return null;
  }

  return readBundleMetadataFile(bundleFile);
}

async function readBundleMetadataFile(
  bundleFile: string,
): Promise<CloudflareBundleMetadata> {
  const parsed = JSON.parse(await readFile(bundleFile, 'utf8')) as
    | CloudflareBundleMetadata
    | CloudflareBundleMetadataV1;

  if ('stagedObjects' in parsed && Array.isArray(parsed.stagedObjects)) {
    return parsed;
  }

  if ('r2Objects' in parsed && Array.isArray(parsed.r2Objects)) {
    return {
      version: 2,
      workerEntry: parsed.workerEntry,
      binaryMode: parsed.binaryMode,
      assetsMaxBytes: parsed.assetsMaxBytes,
      assetsDir: parsed.assetsDir,
      r2Dir: parsed.r2Dir,
      r2Binding: parsed.r2Binding,
      siteTitle: parsed.siteTitle,
      stagedObjects: parsed.r2Objects.map((object) => ({
        kind: 'binary',
        path: object.path,
        mediaType: object.mediaType,
        storageKind: 'r2',
        storageKey: object.storageKey,
        file: object.file,
        byteSize: object.byteSize,
      })),
    };
  }

  throw new Error(
    `Bundle metadata in ${bundleFile} is not supported. Rebuild the Cloudflare bundle with the current mdorigin CLI.`,
  );
}

async function readR2SyncState(stateFile: string): Promise<CloudflareR2SyncState> {
  if (!(await pathExists(stateFile))) {
    return { version: 1, uploaded: {} };
  }

  return JSON.parse(await readFile(stateFile, 'utf8')) as CloudflareR2SyncState;
}

async function buildR2StorageKey(
  filePath: string,
  normalizedPath: string,
): Promise<string> {
  const extension = path.posix.extname(normalizedPath).toLowerCase();
  const hash = await hashFile(filePath);
  return extension ? `binary/${hash}${extension}` : `binary/${hash}`;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  return hash.digest('hex');
}

function runWranglerCommand(
  command: string,
  args: string[],
): { status: number | null; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status,
    stderr: result.stderr ?? '',
  };
}

async function listFiles(
  directory: string,
  visitedRealDirectories = new Set<string>(),
): Promise<string[]> {
  const directoryRealPath = await realpath(directory);
  if (visitedRealDirectories.has(directoryRealPath)) {
    return [];
  }
  visitedRealDirectories.add(directoryRealPath);

  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (isIgnoredContentName(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    const entryStats = await stat(fullPath);
    if (entryStats.isDirectory()) {
      files.push(...(await listFiles(fullPath, visitedRealDirectories)));
      continue;
    }

    if (entryStats.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function buildSearchBundleEntries(
  directory: string,
  assetsMaxBytes: number,
): Promise<ExternalSearchBundleEntry[]> {
  const files = await listFiles(directory);
  const entries: ExternalSearchBundleEntry[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(directory, filePath).replaceAll(path.sep, '/');
    const mediaType = getMediaTypeForPath(relativePath);
    const fileStats = await stat(filePath);
    if (fileStats.size <= assetsMaxBytes) {
      entries.push({
        path: relativePath,
        mediaType,
        storageKind: 'assets',
        storageKey: `${SEARCH_ASSETS_PREFIX}/${relativePath}`,
        byteSize: fileStats.size,
      });
      continue;
    }

    entries.push({
      path: relativePath,
      mediaType,
      storageKind: 'r2',
      storageKey: await buildSearchStorageKey(filePath, relativePath),
      byteSize: fileStats.size,
    });
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

async function buildSearchStorageKey(
  filePath: string,
  relativePath: string,
): Promise<string> {
  const extension = path.posix.extname(relativePath).toLowerCase();
  const hash = await hashFile(filePath);
  return extension ? `search/${hash}${extension}` : `search/${hash}`;
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

function toPosixPath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/');
}

function slugifyWorkerName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug === '' ? null : slug;
}
