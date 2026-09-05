import path from 'node:path';

import { buildDirectoryIndexes } from '../index-builder.js';
import { loadUserSiteConfig } from '../core/site-config.js';

export async function runBuildIndexCommand(argv: string[]) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      'Usage: mdorigin build index (--root <content-dir> | --dir <content-dir>) [--config <config-file>]',
    );
    return;
  }
  if (!args.root && !args.dir) {
    console.error(
      'Usage: mdorigin build index (--root <content-dir> | --dir <content-dir>) [--config <config-file>]',
    );
    process.exitCode = 1;
    return;
  }

  const rootDir = args.root ? path.resolve(args.root) : undefined;
  const dir = args.dir ? path.resolve(args.dir) : undefined;
  const loadedConfig = await loadUserSiteConfig({
    cwd: process.cwd(),
    rootDir: rootDir ?? dir,
    configPath: args.config,
  });

  const result = await buildDirectoryIndexes({
    rootDir,
    dir,
    plugins: loadedConfig.plugins,
    excludedDirectories: (loadedConfig.siteConfig.locales ?? [])
      .filter((locale) => locale.contentBase !== '')
      .map((locale) => locale.contentBase),
  });

  console.log(`updated ${result.updatedFiles.length} index file(s)`);
  if (result.skippedDirectories.length > 0) {
    console.log(`skipped ${result.skippedDirectories.length} director${result.skippedDirectories.length === 1 ? 'y' : 'ies'} without index.md`);
  }
}

function parseArgs(argv: string[]) {
  const result: { root?: string; dir?: string; config?: string; help?: boolean } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    if (argument === '--help' || argument === '-h') {
      result.help = true;
      continue;
    }

    if (argument === '--root' && nextValue) {
      result.root = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--dir' && nextValue) {
      result.dir = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--config' && nextValue) {
      result.config = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument for mdorigin build index: ${argument}`);
  }

  return result;
}
