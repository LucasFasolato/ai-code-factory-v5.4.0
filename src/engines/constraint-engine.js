import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readJsonSafe, writeJson, listFilesRecursive, readText, safeRel } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';

const CONSTRAINTS_FILE = (root) => aiPath(root, 'constraints.json');

export function listConstraints(root) {
  return readJsonSafe(CONSTRAINTS_FILE(root), { locked_constraints: [] }).locked_constraints || [];
}

export function lockConstraint(root, text, options = {}) {
  const data = readJsonSafe(CONSTRAINTS_FILE(root), { locked_constraints: [] });
  const constraints = data.locked_constraints || [];
  const id = `LC-${String(constraints.length + 1).padStart(3, '0')}`;
  const constraint = {
    id,
    text: String(text).trim(),
    pattern: options.pattern || null, // optional regex enforced against source files
    scope: options.scope || 'global',
    locked_at: nowIso()
  };
  constraints.push(constraint);
  writeJson(CONSTRAINTS_FILE(root), { locked_constraints: constraints });
  appendEvent(root, 'CONSTRAINT_LOCKED', { constraint_id: id, text: constraint.text });
  return constraint;
}

export function unlockConstraint(root, id) {
  const data = readJsonSafe(CONSTRAINTS_FILE(root), { locked_constraints: [] });
  const before = data.locked_constraints?.length || 0;
  data.locked_constraints = (data.locked_constraints || []).filter((c) => c.id !== id);
  writeJson(CONSTRAINTS_FILE(root), data);
  return { removed: before !== data.locked_constraints.length };
}

// Checks constraints that declare an enforcement pattern against source files.
// Constraints without a pattern are policy-level: they are injected into
// executor contracts and surfaced in gates as informational.
export function checkConstraints(root, config = {}) {
  const constraints = listConstraints(root);
  const violations = [];
  const enforceable = constraints.filter((c) => c.pattern);
  if (enforceable.length) {
    const fakeConfig = config.fake_data || {};
    const scanDirs = fakeConfig.scan_dirs || ['src', 'app', 'pages', 'components'];
    const ignoreDirs = fakeConfig.ignore_dirs || ['node_modules', '.git', '.ai', 'dist', 'build', '.next'];
    const extensions = fakeConfig.scan_extensions || ['.tsx', '.ts', '.jsx', '.js', '.html', '.css', '.md'];
    const files = scanDirs.flatMap((dir) => listFilesRecursive(path.join(root, dir), { ignoreDirs, extensions }));
    for (const file of files) {
      const content = readText(file, '');
      for (const c of enforceable) {
        let regex;
        try { regex = new RegExp(c.pattern, 'i'); } catch { continue; }
        if (regex.test(content)) violations.push({ constraint_id: c.id, text: c.text, file: safeRel(root, file) });
      }
    }
  }
  return {
    total: constraints.length,
    enforceable: enforceable.length,
    violations,
    status: violations.length ? 'failed' : (constraints.length ? 'passed' : 'not_required'),
    generated_at: nowIso()
  };
}
