import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncPortable } from '../core/spawn-portable.js';
import { aiPath, requestPaths } from '../core/paths.js';
import { readJsonSafe, writeJson, ensureDir } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { detectBaseBranch, isGitRepo } from './git-workflow.js';

// v5.0 Deterministic Gates — zero-token quality enforcement.
// LLMs judge; tools verify. Every check here costs $0 per run, is 100%
// reproducible, and is scoped to the REQ diff (we review the change, not the
// whole repo). External scanners (semgrep, ast-grep) are used when installed
// and skipped gracefully when not.

export function diffFiles(root, base = null) {
  if (!isGitRepo(root)) return { available: false, files: [], reason: 'Not a git repository.' };
  const baseBranch = base || safeBase(root);
  const range = baseBranch ? `${baseBranch}...HEAD` : 'HEAD';
  let result = git(root, ['diff', '--name-only', range]);
  if (result.status !== 0) result = git(root, ['diff', '--name-only', 'HEAD']);
  const tracked = String(result.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  // Include staged + untracked work-in-progress files so pre-commit runs see them too.
  const untracked = String(git(root, ['ls-files', '--others', '--exclude-standard']).stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])].filter((f) => !f.startsWith('.ai/'));
  return { available: true, base: baseBranch, files };
}

export function runDeterministicGates(root, requestId, config = {}, options = {}) {
  const diff = diffFiles(root, options.base || null);
  const checks = [];
  checks.push(migrationGate(root, diff, config));
  checks.push(...standardsRulesGate(root, diff, config));
  const semgrep = externalScannerGate(root, diff, 'semgrep', ['scan', '--json', '--quiet', '--error'], config);
  if (semgrep) checks.push(semgrep);
  const astGrep = externalScannerGate(root, diff, 'ast-grep', ['scan', '--json'], config);
  if (astGrep) checks.push(astGrep);

  const failed = checks.filter((c) => !c.passed && c.severity === 'error');
  const warnings = checks.filter((c) => !c.passed && c.severity === 'warning');
  const result = {
    request_id: requestId,
    generated_at: nowIso(),
    diff_base: diff.base || null,
    diff_available: diff.available,
    files_reviewed: diff.files,
    checks,
    passed: failed.length === 0,
    failed_count: failed.length,
    warning_count: warnings.length
  };
  ensureDir(aiPath(root, 'reasoning', 'gates'));
  writeJson(deterministicGatePath(root, requestId), result);
  return result;
}

export function deterministicGatePath(root, requestId) {
  return aiPath(root, 'reasoning', 'gates', `${requestId}-deterministic.json`);
}

export function readDeterministicGates(root, requestId) {
  return readJsonSafe(deterministicGatePath(root, requestId), null);
}

// ── Gate: entity changed without a migration ────────────────────────────────
// The most expensive class of production bug, and the cheapest to detect.
function migrationGate(root, diff, config = {}) {
  const cfg = config.deterministic_gates?.migration || {};
  if (cfg.enabled === false) return check('database_migration', true, 'info', 'Migration gate disabled by config.');
  if (!diff.available) return check('database_migration', true, 'info', 'No git diff available; migration gate skipped.');
  const entityPatterns = cfg.entity_patterns || ['.entity.ts', '.entity.js', 'schema.prisma'];
  const migrationPatterns = cfg.migration_patterns || ['migrations/', 'migration/', 'prisma/migrations/'];
  const entityChanged = diff.files.filter((f) => entityPatterns.some((p) => f.includes(p)));
  if (!entityChanged.length) return check('database_migration', true, 'info', 'No entity/schema changes in diff.');
  const migrationChanged = diff.files.some((f) => migrationPatterns.some((p) => f.includes(p)));
  return check(
    'database_migration',
    migrationChanged,
    'error',
    migrationChanged
      ? `Entity change is accompanied by a migration (${entityChanged.join(', ')}).`
      : `Entity/schema changed without a migration: ${entityChanged.join(', ')}. Add a migration or explicitly disable this gate for the REQ.`,
    { entities_changed: entityChanged }
  );
}

// ── Gate: project standards as executable rules ─────────────────────────────
// .ai/standards/rules.json turns "no DB access from controllers" from a
// sentence in a markdown file into a check that can block a merge.
// Rule shape: { id, description, files (substring filters), forbidden_pattern
// or required_pattern (regex source), severity: error|warning }
function standardsRulesGate(root, diff, config = {}) {
  const rulesFile = aiPath(root, 'standards', 'rules.json');
  const rules = readJsonSafe(rulesFile, null);
  if (!Array.isArray(rules) || !rules.length) return [check('standards_rules', true, 'info', 'No executable standards rules defined (.ai/standards/rules.json).')];
  const targets = diff.available && diff.files.length ? diff.files : [];
  const results = [];
  for (const rule of rules) {
    const applicable = targets.filter((f) => matchesFilters(f, rule.files));
    if (!applicable.length) { results.push(check(`rule:${rule.id}`, true, 'info', `No changed files match rule ${rule.id}.`)); continue; }
    const violations = [];
    for (const rel of applicable) {
      const full = path.join(root, rel);
      let content = '';
      try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (rule.forbidden_pattern && new RegExp(rule.forbidden_pattern, 'm').test(content)) violations.push(rel);
      if (rule.required_pattern && !new RegExp(rule.required_pattern, 'm').test(content)) violations.push(rel);
    }
    results.push(check(
      `rule:${rule.id}`,
      violations.length === 0,
      rule.severity === 'warning' ? 'warning' : 'error',
      violations.length ? `${rule.description || rule.id} — violated in: ${violations.join(', ')}` : `${rule.description || rule.id} — OK (${applicable.length} file(s) checked).`,
      { violations }
    ));
  }
  return results;
}

function matchesFilters(file, filters) {
  if (!filters || !filters.length) return true;
  return filters.some((f) => file.includes(f));
}

// ── Gate: external scanners when available ──────────────────────────────────
function externalScannerGate(root, diff, command, args, config = {}) {
  const cfg = config.deterministic_gates?.[command.replace('-', '_')] || {};
  if (cfg.enabled === false) return null;
  const probe = spawnSyncPortable(command, ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (probe.error || probe.status !== 0) return null; // not installed → silently skip
  const targets = diff.available ? diff.files.filter((f) => /\.(ts|tsx|js|jsx|py)$/.test(f)) : [];
  if (!targets.length) return check(command, true, 'info', `${command} installed but no scannable files in diff.`);
  const run = spawnSyncPortable(command, [...args, ...targets], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  const findings = countScannerFindings(command, run.stdout);
  return check(
    command,
    findings === 0,
    'error',
    findings === 0 ? `${command}: no findings on ${targets.length} changed file(s).` : `${command}: ${findings} finding(s) on changed files. Run \`${command} ${args.join(' ')} <files>\` for details.`,
    { findings, files_scanned: targets.length }
  );
}

function countScannerFindings(command, stdout) {
  try {
    const parsed = JSON.parse(String(stdout || '{}'));
    if (command === 'semgrep') return (parsed.results || []).length;
    if (Array.isArray(parsed)) return parsed.length;
    return (parsed.matches || parsed.results || []).length;
  } catch { return 0; }
}

function check(id, passed, severity, detail, extra = {}) {
  return { id, passed, severity, detail, ...extra };
}

function git(root, args) {
  return spawnSyncPortable('git', args, { cwd: root, encoding: 'utf8', timeout: 20000 });
}

function safeBase(root) {
  try { return detectBaseBranch(root); } catch { return null; }
}
