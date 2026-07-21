import { exists, readJsonSafe } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { allowedFilesFor } from './execution-contract-engine.js';

export function evaluateScopeGate(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJsonSafe(paths.intake, null);
  const execution = exists(paths.executionStatus) ? readJsonSafe(paths.executionStatus, null) : null;
  if (!intake) return { status: 'pending', reason: 'Intake missing.', violations: [], allowed_files: [] };
  const allowed = allowedFilesFor(intake);
  if (!execution) return { status: 'pending', reason: 'Executor has not run yet.', violations: [], allowed_files: allowed };
  if (!Array.isArray(execution.files_touched)) return { status: 'warning', reason: 'files_touched unavailable; cannot enforce scope.', violations: [], allowed_files: allowed };
  if (!canEnforce(allowed)) return { status: 'warning', reason: 'Allowed files strategy is descriptive; scope cannot be enforced automatically.', violations: [], allowed_files: allowed };
  const violations = execution.files_touched.filter((file) => !matchesAny(file, allowed));
  if (violations.length) return { status: 'failed', reason: `${violations.length} file(s) touched outside approved scope.`, violations, allowed_files: allowed };
  return { status: 'passed', reason: `All ${execution.files_touched.length} touched file(s) are inside approved scope.`, violations: [], allowed_files: allowed };
}

function canEnforce(patterns) {
  return patterns.some((p) => /[*]/.test(p) || /^[.a-zA-Z0-9_/-]+$/.test(p));
}

function matchesAny(file, patterns) {
  const normalized = normalize(file);
  return patterns.some((pattern) => matchesPattern(normalized, normalize(pattern)));
}

function matchesPattern(file, pattern) {
  if (!pattern || /directly related|request only/i.test(pattern)) return true;
  if (pattern.endsWith('/**')) return file === pattern.slice(0, -3) || file.startsWith(pattern.slice(0, -3) + '/');
  if (pattern.endsWith('/')) return file.startsWith(pattern);
  if (!pattern.includes('*')) return file === pattern || file.startsWith(pattern.replace(/\/[^/]*$/, '') + '/');
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`).test(file);
}

function normalize(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}
