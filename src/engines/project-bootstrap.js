import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe, writeJson } from '../core/fs.js';
import { runCommand } from '../core/command-runner.js';
import { isGitRepo, hasAnyCommit } from './git-workflow.js';

export function bootstrapProject(root, config = {}, options = {}) {
  const env = process.env;
  const base = { enabled: true, ensure_validation_scripts: true, initialize_git_if_missing: true, create_initial_commit_if_empty: true, ...(config.project_bootstrap || {}) };
  const cfg = {
    ...base,
    enabled: env.ACF_PROJECT_BOOTSTRAP_ENABLED ? env.ACF_PROJECT_BOOTSTRAP_ENABLED !== 'false' : base.enabled,
    ensure_validation_scripts: env.ACF_PROJECT_BOOTSTRAP_VALIDATION_SCRIPTS ? env.ACF_PROJECT_BOOTSTRAP_VALIDATION_SCRIPTS !== 'false' : base.ensure_validation_scripts,
    initialize_git_if_missing: env.ACF_PROJECT_BOOTSTRAP_INIT_GIT ? env.ACF_PROJECT_BOOTSTRAP_INIT_GIT !== 'false' : base.initialize_git_if_missing,
    create_initial_commit_if_empty: env.ACF_PROJECT_BOOTSTRAP_INITIAL_COMMIT ? env.ACF_PROJECT_BOOTSTRAP_INITIAL_COMMIT !== 'false' : base.create_initial_commit_if_empty
  };
  if (!cfg.enabled) return { status: 'skipped', changed: [], warnings: ['project bootstrap disabled'], git: { initialized: false, initial_commit_created: false, status: null }, dry_run: Boolean(options.dryRun) };
  const changed = [];
  const warnings = [];

  if (cfg.ensure_validation_scripts) {
    const pkgPath = path.join(root, 'package.json');
    const pkg = readJsonSafe(pkgPath, null);
    if (pkg) {
      pkg.scripts ||= {};
      if (!pkg.scripts.lint) { pkg.scripts.lint = 'eslint .'; changed.push('package.json:scripts.lint'); }
      if (!pkg.scripts.typecheck) { pkg.scripts.typecheck = 'tsc --noEmit'; changed.push('package.json:scripts.typecheck'); }
      if (!pkg.scripts.test) { pkg.scripts.test = 'echo "No tests configured"'; changed.push('package.json:scripts.test'); }
      if (!pkg.scripts.build && hasDependency(pkg, 'next')) { pkg.scripts.build = 'next build'; changed.push('package.json:scripts.build'); }
      if (!options.dryRun && changed.some((c) => c.startsWith('package.json:'))) writeJson(pkgPath, pkg);
    } else {
      warnings.push('No package.json found; validation scripts were not bootstrapped.');
    }
  }

  let git = { initialized: false, initial_commit_created: false, status: null };
  if (cfg.initialize_git_if_missing && !isGitRepo(root)) {
    const init = options.dryRun ? { success: true } : runCommand('git', ['init'], { cwd: root, timeout: 120000 });
    git.initialized = Boolean(init.success);
    if (init.success) changed.push('git:init');
    else warnings.push(`git init failed: ${init.stderr_preview || init.error || 'unknown error'}`);
  }

  if (cfg.create_initial_commit_if_empty && isGitRepo(root) && !hasAnyCommit(root)) {
    if (!options.dryRun) {
      runCommand('git', ['add', '-A'], { cwd: root, timeout: 120000 });
      const commit = runCommand('git', ['-c', 'user.name=AI Code Factory', '-c', 'user.email=ai-code-factory@example.local', 'commit', '-m', 'chore: bootstrap project for AI Code Factory'], { cwd: root, timeout: 120000 });
      git.initial_commit_created = Boolean(commit.success);
      if (commit.success) changed.push('git:initial-commit');
      else warnings.push(`initial commit failed: ${commit.stderr_preview || commit.error || 'unknown error'}`);
    } else {
      git.initial_commit_created = true;
      changed.push('git:initial-commit');
    }
  }
  git.status = isGitRepo(root) ? runCommand('git', ['status', '--short'], { cwd: root, timeout: 30000 }).stdout : null;

  return { status: warnings.length ? 'warnings' : 'ok', changed, warnings, git, dry_run: Boolean(options.dryRun) };
}

function hasDependency(pkg, name) {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}
