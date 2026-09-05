import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildDirectoryIndexes,
  buildManagedIndexBlock,
  upsertManagedIndexBlock,
} from './index-builder.js';

test('buildManagedIndexBlock renders directories and articles with sorting', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-block-'));
  await mkdir(path.join(rootDir, 'zeta'));
  await writeFile(
    path.join(rootDir, 'zeta', 'index.md'),
    ['---', 'title: Zeta Notes', 'order: 20', 'type: page', '---', '', '# Zeta'].join('\n'),
    'utf8',
  );
  await mkdir(path.join(rootDir, 'alpha'));
  await writeFile(
    path.join(rootDir, 'alpha', 'index.md'),
    ['---', 'title: Alpha Notes', 'order: 10', 'type: page', '---', '', '# Alpha'].join('\n'),
    'utf8',
  );
  await mkdir(path.join(rootDir, 'essay'));
  await writeFile(
    path.join(rootDir, 'essay', 'README.md'),
    [
      '---',
      'title: Directory Essay',
      'type: post',
      'order: 5',
      'date: 2025-04-05',
      'summary: Essay summary',
      '---',
      '',
      '# Essay',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(rootDir, 'old.md'),
    ['---', 'title: Old Post', 'order: 30', 'date: 2024-01-03', 'summary: Old summary', '---', '', '# Old'].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(rootDir, 'new.md'),
    ['---', 'title: New Post', 'order: 20', 'date: 2025-03-04', '---', '', 'First paragraph summary.', '', '# Heading later'].join('\n'),
    'utf8',
  );
  await writeFile(path.join(rootDir, 'index.md'), '# Root\n', 'utf8');

  const block = await buildManagedIndexBlock(rootDir);

  assert.match(block, /\[Alpha Notes\]\(\.\/alpha\/\)[\s\S]*\[Zeta Notes\]\(\.\/zeta\/\)/);
  assert.match(block, /\[Directory Essay\]\(\.\/essay\/\)[\s\S]*2025-04-05 · Essay summary/);
  assert.match(block, /\[New Post\]\(\.\/new\.md\)[\s\S]*2025-03-04 · First paragraph summary\./);
  assert.match(block, /\[Old Post\]\(\.\/old\.md\)[\s\S]*2024-01-03 · Old summary/);
  assert.ok(block.indexOf('Alpha Notes') < block.indexOf('Zeta Notes'));
  assert.ok(block.indexOf('Directory Essay') < block.indexOf('New Post'));
  assert.ok(block.indexOf('New Post') < block.indexOf('Old Post'));
});

test('buildManagedIndexBlock applies transformIndex plugins', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-plugin-'));
  await writeFile(path.join(rootDir, 'README.md'), '# Root\n', 'utf8');
  await writeFile(
    path.join(rootDir, 'guide.md'),
    ['---', 'title: Guide', 'summary: Intro guide', '---', '', '# Guide'].join('\n'),
    'utf8',
  );

  const block = await buildManagedIndexBlock(rootDir, [
    {
      name: 'rewrite-index',
      transformIndex(entries) {
        return entries.map((entry) =>
          entry.kind === 'article'
            ? {
                ...entry,
                title: `${entry.title} Updated`,
                detail: 'Plugin detail',
              }
            : entry,
        );
      },
    },
  ]);

  assert.match(block, /\[Guide Updated\]\(\.\/guide\.md\)/);
  assert.match(block, /Plugin detail/);
});

test('upsertManagedIndexBlock replaces existing managed section', () => {
  const source = [
    '# Writing',
    '',
    '<!-- INDEX:START -->',
    'Old content',
    '<!-- INDEX:END -->',
    '',
    'Trailing note',
  ].join('\n');

  const updated = upsertManagedIndexBlock(
    source,
    ['<!-- INDEX:START -->', '', '- [Post](./post.md)', '', '<!-- INDEX:END -->'].join('\n'),
  );

  assert.doesNotMatch(updated, /Old content/);
  assert.match(updated, /Trailing note/);
  assert.match(updated, /\[Post\]\(\.\/post\.md\)/);
});

test('upsertManagedIndexBlock appends markers when missing', () => {
  const updated = upsertManagedIndexBlock('# Writing\n\nIntro text.\n', '<!-- INDEX:START -->\n\n<!-- INDEX:END -->');
  assert.match(updated, /Intro text\.\n\n<!-- INDEX:START -->/);
  assert.match(updated, /<!-- INDEX:END -->\n$/);
});

test('buildManagedIndexBlock leaves empty directories blank', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-empty-'));
  await writeFile(path.join(rootDir, 'README.md'), '# Empty\n', 'utf8');

  const block = await buildManagedIndexBlock(rootDir);

  assert.equal(block, ['<!-- INDEX:START -->', '', '<!-- INDEX:END -->'].join('\n'));
});

test('buildManagedIndexBlock ignores empty child directories', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-empty-child-'));
  await writeFile(path.join(rootDir, 'README.md'), '# Home\n', 'utf8');
  await mkdir(path.join(rootDir, 'real-post'));
  await writeFile(
    path.join(rootDir, 'real-post', 'README.md'),
    ['---', 'title: Real Post', 'type: post', '---', '', '# Real Post'].join('\n'),
    'utf8',
  );
  await mkdir(path.join(rootDir, 'empty-dir'));

  const block = await buildManagedIndexBlock(rootDir);

  assert.match(block, /\[Real Post\]\(\.\/real-post\/\)/);
  assert.doesNotMatch(block, /\[empty-dir\]\(\.\/empty-dir\/\)/);
});

test('buildDirectoryIndexes updates existing index files recursively', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-build-'));
  await writeFile(path.join(rootDir, 'index.md'), '# Root\n', 'utf8');
  await mkdir(path.join(rootDir, 'posts'));
  await writeFile(path.join(rootDir, 'posts', 'index.md'), '# Posts\n', 'utf8');
  await writeFile(
    path.join(rootDir, 'posts', 'hello.md'),
    ['---', 'title: Hello', 'summary: Greeting', '---', '', '# Hello'].join('\n'),
    'utf8',
  );
  await mkdir(path.join(rootDir, 'drafts'));
  await writeFile(
    path.join(rootDir, 'drafts', 'note.md'),
    ['---', 'draft: true', '---', '', '# Draft'].join('\n'),
    'utf8',
  );

  const result = await buildDirectoryIndexes({ rootDir });

  assert.equal(result.updatedFiles.length, 2);
  assert.ok(result.skippedDirectories.some((entry) => entry.endsWith('/drafts')));

  const rootIndex = await readFile(path.join(rootDir, 'index.md'), 'utf8');
  assert.match(rootIndex, /\[posts\]\(\.\/posts\/\)/i);

  const postsIndex = await readFile(path.join(rootDir, 'posts', 'index.md'), 'utf8');
  assert.match(postsIndex, /\[Hello\]\(\.\/hello\.md\)/);
  assert.doesNotMatch(postsIndex, /draft/i);
});

test('buildDirectoryIndexes skips empty directories and nested empty directories', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-skip-empty-'));
  await writeFile(path.join(rootDir, 'README.md'), '# Root\n', 'utf8');
  await mkdir(path.join(rootDir, 'real-section'));
  await writeFile(path.join(rootDir, 'real-section', 'README.md'), '# Real Section\n', 'utf8');
  await writeFile(
    path.join(rootDir, 'real-section', 'hello.md'),
    ['---', 'title: Hello', '---', '', '# Hello'].join('\n'),
    'utf8',
  );
  await mkdir(path.join(rootDir, 'empty-dir'));
  await mkdir(path.join(rootDir, 'empty-parent', 'empty-child'), { recursive: true });

  const result = await buildDirectoryIndexes({ rootDir });
  const rootIndex = await readFile(path.join(rootDir, 'README.md'), 'utf8');

  assert.ok(!result.skippedDirectories.some((entry) => entry.endsWith('/empty-dir')));
  assert.ok(!result.skippedDirectories.some((entry) => entry.endsWith('/empty-parent')));
  assert.ok(!result.updatedFiles.some((entry) => entry.endsWith('/empty-dir/index.md')));
  assert.ok(!result.updatedFiles.some((entry) => entry.endsWith('/empty-parent/index.md')));
  assert.match(rootIndex, /\[Real Section\]\(\.\/real-section\/\)/);
  assert.doesNotMatch(rootIndex, /\[empty-dir\]\(\.\/empty-dir\/\)/);
  assert.doesNotMatch(rootIndex, /\[empty-parent\]\(\.\/empty-parent\/\)/);
});

test('buildDirectoryIndexes updates README.md when index.md is missing', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-readme-'));
  await writeFile(path.join(rootDir, 'README.md'), '# Docs Home\n', 'utf8');
  await writeFile(
    path.join(rootDir, 'getting-started.md'),
    ['---', 'title: Getting Started', '---', '', '# Getting Started'].join('\n'),
    'utf8',
  );

  const result = await buildDirectoryIndexes({ dir: rootDir });

  assert.equal(result.updatedFiles.length, 1);
  assert.ok(result.updatedFiles[0]?.endsWith('README.md'));

  const readme = await readFile(path.join(rootDir, 'README.md'), 'utf8');
  assert.match(readme, /<!-- INDEX:START -->/);
  assert.match(readme, /\[Getting Started\]\(\.\/getting-started\.md\)/);
});

test('buildDirectoryIndexes skips type post directory bundles', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-post-bundle-'));
  await mkdir(path.join(rootDir, 'hui-xiang-za-ji'));
  await writeFile(path.join(rootDir, 'index.md'), '# Root\n', 'utf8');
  const postReadmePath = path.join(rootDir, 'hui-xiang-za-ji', 'README.md');
  const original = [
    '---',
    'title: 回乡杂记',
    'type: post',
    '---',
    '',
    '# 回乡杂记',
  ].join('\n');
  await writeFile(postReadmePath, original, 'utf8');
  await writeFile(path.join(rootDir, 'hui-xiang-za-ji', '0523_091247.jpg'), 'binary', 'utf8');

  const result = await buildDirectoryIndexes({ rootDir });

  assert.ok(
    result.skippedDirectories.some((entry) => entry.endsWith('/hui-xiang-za-ji')),
  );
  assert.equal(await readFile(postReadmePath, 'utf8'), original);
});

test('buildManagedIndexBlock treats skill directories as article bundles', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-skill-bundle-'));
  await writeFile(path.join(rootDir, 'README.md'), '# Skills\n', 'utf8');
  await mkdir(path.join(rootDir, 'find-skills'));
  await writeFile(
    path.join(rootDir, 'find-skills', 'SKILL.md'),
    [
      '---',
      'name: find-skills',
      'description: Discover skills from the ecosystem.',
      '---',
      '',
      '# Find Skills',
    ].join('\n'),
    'utf8',
  );
  await mkdir(path.join(rootDir, 'find-skills', 'scripts'));
  await writeFile(
    path.join(rootDir, 'find-skills', 'scripts', 'install.sh'),
    '#!/usr/bin/env bash\necho install\n',
    'utf8',
  );

  const block = await buildManagedIndexBlock(rootDir);

  assert.match(block, /\[find-skills\]\(\.\/find-skills\/\)/);
  assert.match(block, /Discover skills from the ecosystem\./);
});

test('buildDirectoryIndexes does not recurse into skill support directories', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-skill-skip-'));
  await writeFile(path.join(rootDir, 'README.md'), '# Skills\n', 'utf8');
  await mkdir(path.join(rootDir, 'find-skills'));
  await writeFile(
    path.join(rootDir, 'find-skills', 'SKILL.md'),
    [
      '---',
      'name: find-skills',
      'description: Discover skills from the ecosystem.',
      '---',
      '',
      '# Find Skills',
    ].join('\n'),
    'utf8',
  );
  await mkdir(path.join(rootDir, 'find-skills', 'scripts'));
  await writeFile(
    path.join(rootDir, 'find-skills', 'scripts', 'README.md'),
    '# Script helpers\n',
    'utf8',
  );

  const result = await buildDirectoryIndexes({ rootDir });

  assert.ok(
    result.skippedDirectories.some((entry) => entry.endsWith('/find-skills')),
  );
  assert.ok(
    !result.updatedFiles.some((entry) => entry.endsWith('/find-skills/scripts/README.md')),
  );
});

test('buildDirectoryIndexes follows symlinked skill directories', async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-symlink-skill-'));
  const rootDir = path.join(workspaceDir, 'docs', 'site');
  const skillsDir = path.join(workspaceDir, 'skills');
  await mkdir(rootDir, { recursive: true });
  await mkdir(path.join(skillsDir, 'find-skills', 'scripts'), { recursive: true });
  await writeFile(path.join(rootDir, 'README.md'), '# Skills\n', 'utf8');
  await writeFile(
    path.join(skillsDir, 'find-skills', 'SKILL.md'),
    [
      '---',
      'name: find-skills',
      'description: Discover skills from the ecosystem.',
      '---',
      '',
      '# Find Skills',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(skillsDir, 'find-skills', 'scripts', 'README.md'),
    '# Script helpers\n',
    'utf8',
  );
  await symlink(path.join(workspaceDir, 'skills'), path.join(rootDir, 'skills'));

  const result = await buildDirectoryIndexes({ rootDir });
  const rootIndex = await readFile(path.join(rootDir, 'README.md'), 'utf8');

  assert.match(rootIndex, /\[skills\]\(\.\/skills\/\)/);
  assert.ok(
    result.skippedDirectories.some((entry) => entry.endsWith('/docs/site/skills/find-skills')),
  );
  assert.ok(
    !result.updatedFiles.some((entry) => entry.endsWith('/skills/find-skills/scripts/README.md')),
  );
});

test('buildManagedIndexBlock excludes configured locale directories', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'mdorigin-index-locale-exclude-'));
  await writeFile(path.join(rootDir, 'README.md'), '# Home\n', 'utf8');
  await mkdir(path.join(rootDir, 'guides'));
  await writeFile(path.join(rootDir, 'guides', 'README.md'), '# Guides\n', 'utf8');
  await mkdir(path.join(rootDir, 'zh-CN'));
  await writeFile(path.join(rootDir, 'zh-CN', 'README.md'), '# 首页\n', 'utf8');

  const block = await buildManagedIndexBlock(rootDir, [], ['zh-CN']);

  assert.match(block, /\[Guides\]\(\.\/guides\/\)/);
  assert.doesNotMatch(block, /zh-CN/);
});
