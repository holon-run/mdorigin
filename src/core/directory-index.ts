import path from 'node:path';

export const DIRECTORY_INDEX_FILENAMES = [
  'index.md',
  'README.md',
  'SKILL.md',
] as const;

export function getDirectoryIndexCandidates(directoryPath: string): string[] {
  return DIRECTORY_INDEX_FILENAMES.map((filename) =>
    directoryPath === '' ? filename : path.posix.join(directoryPath, filename),
  );
}

/** Match request routing's index.md > README.md > SKILL.md preference. */
export function isCanonicalContentSource(contentPath: string, availablePaths: ReadonlySet<string>): boolean {
  const directory = path.posix.dirname(contentPath);
  const candidates = getDirectoryIndexCandidates(directory === '.' ? '' : directory);
  return !candidates.includes(contentPath) || candidates.find((candidate) => availablePaths.has(candidate)) === contentPath;
}
