import fs from 'node:fs';
import path from 'node:path';
import { listFilesRecursive, safeRel } from '../core/fs.js';
import { nowIso } from '../core/format.js';

// test-gaps: detects source files without a corresponding test file.
export function findTestGaps(root, options = {}) {
  const sourceDirs = options.sourceDirs || ['src', 'app', 'lib'];
  const testDirs = options.testDirs || ['tests', 'test', '__tests__'];
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  const ignoreDirs = ['node_modules', '.git', '.ai', 'dist', 'build', '.next', 'coverage'];

  const sourceFiles = sourceDirs
    .flatMap((d) => listFilesRecursive(path.join(root, d), { extensions, ignoreDirs }))
    .filter((f) => !isTestFile(f));

  const testFiles = [
    ...testDirs.flatMap((d) => listFilesRecursive(path.join(root, d), { extensions, ignoreDirs })),
    ...sourceFiles.length ? sourceDirs.flatMap((d) => listFilesRecursive(path.join(root, d), { extensions, ignoreDirs })).filter(isTestFile) : []
  ];
  const testBasenames = new Set(testFiles.map((f) => normalizeBase(path.basename(f))));
  const testContent = testFiles.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');

  const gaps = [];
  for (const file of sourceFiles) {
    const base = normalizeBase(path.basename(file));
    const referenced = testBasenames.has(base) || testContent.includes(base) || testContent.includes(path.basename(file, path.extname(file)));
    if (!referenced) gaps.push(safeRel(root, file));
  }

  const coverage = sourceFiles.length ? Math.round(((sourceFiles.length - gaps.length) / sourceFiles.length) * 100) : null;
  return {
    status: gaps.length ? 'gaps_found' : 'ok',
    source_files: sourceFiles.length,
    test_files: testFiles.length,
    estimated_reference_coverage: coverage,
    gaps: gaps.slice(0, 100),
    note: 'Heuristic: a source file counts as covered if any test file references its name. Real coverage requires a coverage tool.',
    generated_at: nowIso()
  };
}

function isTestFile(file) {
  return /\.(test|spec)\.[jt]sx?$/.test(file) || /[\\/](tests?|__tests__)[\\/]/.test(file);
}

function normalizeBase(name) {
  return name.replace(/\.(test|spec)(?=\.[jt]sx?$)/, '').replace(/\.[jt]sx?$/, '');
}
