import fs from 'node:fs';
import path from 'node:path';
import { listFilesRecursive, readText } from '../core/fs.js';
import { budgetText } from '../core/prompt-budget.js';

// Gathers concrete, factual signals about the codebase so the brain can reason
// about real weaknesses and opportunities instead of guessing. Everything here
// is deterministic measurement; the *judgment* is left to the brain.

const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx'];
const IGNORE = ['node_modules', '.git', '.ai', '.next', 'dist', 'build', 'coverage'];

export function scanCodeInsights(root, options = {}) {
  const srcRoots = ['src', 'app', 'pages', 'components', 'apps', 'packages', 'lib', 'server']
    .map((d) => path.join(root, d))
    .filter((d) => fs.existsSync(d));
  const files = srcRoots.length
    ? srcRoots.flatMap((d) => listFilesRecursive(d, { extensions: CODE_EXTS, ignoreDirs: IGNORE }))
    : listFilesRecursive(root, { extensions: CODE_EXTS, ignoreDirs: IGNORE });

  const fileStats = [];
  const todos = [];
  let totalLines = 0;
  let testFiles = 0;
  const dirs = new Set();

  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (/\.(test|spec)\.[tj]sx?$/.test(rel) || /(^|\/)(tests?|__tests__)\//.test(rel)) testFiles += 1;
    dirs.add(path.dirname(rel));
    let text = '';
    try { text = readText(file, ''); } catch { continue; }
    const lines = text.split('\n').length;
    totalLines += lines;
    const todoCount = (text.match(/\b(TODO|FIXME|HACK|XXX)\b/g) || []).length;
    if (todoCount) todos.push({ file: rel, count: todoCount });
    fileStats.push({ file: rel, lines, exports: (text.match(/\bexport\b/g) || []).length, anyTypes: (text.match(/:\s*any\b/g) || []).length });
  }

  fileStats.sort((a, b) => b.lines - a.lines);
  const largest = fileStats.slice(0, 10);
  const anyUsage = fileStats.filter((f) => f.anyTypes > 0).slice(0, 10);

  const pkg = readJsonSafe(path.join(root, 'package.json'));
  const hasTests = testFiles > 0;
  const scripts = pkg?.scripts || {};
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

  const signals = {
    has_package_json: Boolean(pkg),
    detected_stack: detectStack(deps, root),
    source_files: files.length,
    total_lines: totalLines,
    directories: dirs.size,
    test_files: testFiles,
    has_tests: hasTests,
    test_ratio: files.length ? Number((testFiles / files.length).toFixed(2)) : 0,
    largest_files: largest,
    files_using_any: anyUsage,
    todo_markers: todos.slice(0, 15),
    todo_total: todos.reduce((s, t) => s + t.count, 0),
    scripts: Object.keys(scripts),
    missing_quality_scripts: ['lint', 'typecheck', 'test', 'build'].filter((s) => !scripts[s]),
    config_present: {
      typescript: fs.existsSync(path.join(root, 'tsconfig.json')),
      eslint: fs.existsSync(path.join(root, '.eslintrc')) || fs.existsSync(path.join(root, '.eslintrc.json')) || fs.existsSync(path.join(root, 'eslint.config.js')) || Boolean(deps.eslint),
      prettier: fs.existsSync(path.join(root, '.prettierrc')) || Boolean(deps.prettier),
      env_example: fs.existsSync(path.join(root, '.env.example')),
      ci: fs.existsSync(path.join(root, '.github', 'workflows')),
      dockerfile: fs.existsSync(path.join(root, 'Dockerfile'))
    }
  };

  // Cheap deterministic weakness flags (the brain refines/prioritizes these).
  const weaknesses = [];
  if (!hasTests) weaknesses.push('No test files detected.');
  else if (signals.test_ratio < 0.1) weaknesses.push(`Low test coverage signal: only ${testFiles} test file(s) for ${files.length} source files.`);
  if (largest[0]?.lines > 400) weaknesses.push(`Large file detected (${largest[0].file}, ${largest[0].lines} lines) — consider decomposition.`);
  if (signals.files_using_any.length) weaknesses.push(`${signals.files_using_any.length} file(s) use \`any\` types, weakening type safety.`);
  if (signals.missing_quality_scripts.length) weaknesses.push(`Missing quality scripts: ${signals.missing_quality_scripts.join(', ')}.`);
  if (!signals.config_present.eslint) weaknesses.push('No ESLint configuration detected.');
  if (!signals.config_present.ci) weaknesses.push('No CI workflow detected.');
  if (signals.todo_total > 0) weaknesses.push(`${signals.todo_total} TODO/FIXME marker(s) across the codebase.`);
  signals.deterministic_weaknesses = weaknesses;

  return signals;
}

// A compact, budgeted text digest for embedding in a brain prompt.
export function insightsDigest(signals, maxChars = 6000) {
  const lines = [
    `Stack: ${signals.detected_stack}`,
    `Files: ${signals.source_files} | Lines: ${signals.total_lines} | Dirs: ${signals.directories}`,
    `Tests: ${signals.test_files} files (ratio ${signals.test_ratio})`,
    `Quality scripts: ${signals.scripts.join(', ') || 'none'}; missing: ${signals.missing_quality_scripts.join(', ') || 'none'}`,
    `Config: ${Object.entries(signals.config_present).filter(([, v]) => v).map(([k]) => k).join(', ') || 'minimal'}`,
    `Largest files: ${signals.largest_files.slice(0, 5).map((f) => `${f.file} (${f.lines}L)`).join('; ')}`,
    `\`any\` usage in: ${signals.files_using_any.map((f) => f.file).join(', ') || 'none'}`,
    `TODO/FIXME total: ${signals.todo_total}`,
    `Deterministic weaknesses:`,
    ...signals.deterministic_weaknesses.map((w) => `- ${w}`)
  ];
  return budgetText(lines.join('\n'), maxChars);
}

function detectStack(deps, root) {
  const flags = [];
  if (deps.next) flags.push('Next.js');
  if (deps['@nestjs/core']) flags.push('NestJS');
  if (deps.react && !deps.next) flags.push('React');
  if (deps.express) flags.push('Express');
  if (deps.typeorm) flags.push('TypeORM');
  if (deps.prisma || deps['@prisma/client']) flags.push('Prisma');
  if (deps.pg || deps.postgres) flags.push('PostgreSQL');
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) flags.push('TypeScript');
  return flags.length ? flags.join(' + ') : 'unknown';
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
