import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readJson, listFilesRecursive, safeRel } from '../core/fs.js';
import { nowIso } from '../core/format.js';

// architecture-drift: compares the actual project structure against the
// expected architecture declared in .ai/project-dna.json
export function detectArchitectureDrift(root) {
  const dna = readJson(aiPath(root, 'project-dna.json'), null);
  const expected = dna?.expected_architecture || {};
  const issues = [];

  const sourceDirs = expected.source_dirs || ['src'];
  const presentSourceDirs = sourceDirs.filter((d) => fs.existsSync(path.join(root, d)));
  if (!presentSourceDirs.length) {
    issues.push(issue('no-source-dir', `None of the expected source dirs exist: ${sourceDirs.join(', ')}`, 'Create the expected structure or update project-dna.json.'));
  }

  const testDirs = expected.test_dirs || ['tests'];
  const hasTests = testDirs.some((d) => fs.existsSync(path.join(root, d)));
  if (!hasTests) issues.push(issue('no-test-dir', `No expected test dir found (${testDirs.join(', ')}).`, 'Add tests or update project-dna.json.'));

  // Config format drift: critical config should be JSON, not YAML.
  if (expected.config_format === 'json') {
    const yamlFiles = listFilesRecursive(root, { extensions: ['.yml', '.yaml'], ignoreDirs: ['node_modules', '.git', '.ai', 'dist', 'build', '.next'] })
      .filter((f) => !/\.github[\\/]/.test(f));
    if (yamlFiles.length) {
      issues.push(issue('yaml-config', `Found ${yamlFiles.length} YAML files while DNA requires JSON config: ${yamlFiles.slice(0, 5).map((f) => safeRel(root, f)).join(', ')}`, 'Migrate critical config to JSON (CI workflow YAML is excluded).'));
    }
  }

  // Secret-looking files in source.
  const envFiles = listFilesRecursive(root, { ignoreDirs: ['node_modules', '.git', '.ai', 'dist', 'build', '.next'] })
    .filter((f) => /(^|[\\/])\.env($|\.)/.test(f) && !/\.env\.example$/.test(f));
  if (envFiles.length) issues.push(issue('env-files', `.env files present: ${envFiles.map((f) => safeRel(root, f)).join(', ')}`, 'Ensure they are gitignored and never sent to executors.'));

  // Source files in unexpected top-level dirs (light heuristic).
  const topLevel = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const known = new Set([...sourceDirs, ...testDirs, 'node_modules', '.git', '.ai', 'public', 'dist', 'build', '.next', 'docs', 'scripts', '.github', 'coverage']);
  const unknownDirs = topLevel.filter((d) => !known.has(d) && containsSource(path.join(root, d)));
  if (unknownDirs.length) issues.push(issue('unexpected-source-dirs', `Source code found outside expected dirs: ${unknownDirs.join(', ')}`, 'Move code into expected dirs or extend project-dna.json.'));

  return { status: issues.length ? 'drift_detected' : 'aligned', issues, checked_at: nowIso(), dna_present: Boolean(dna) };
}

function containsSource(dir) {
  try {
    return listFilesRecursive(dir, { extensions: ['.ts', '.tsx', '.js', '.jsx'], ignoreDirs: ['node_modules'] }).length > 0;
  } catch {
    return false;
  }
}

function issue(id, message, fix) { return { id, message, fix }; }
