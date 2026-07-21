import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readJsonSafe, writeJson, safeRel } from '../core/fs.js';
import { runCommand } from '../core/command-runner.js';
import { loadRequest } from '../core/state.js';
import { nowIso } from '../core/format.js';

function workflowConfig(config = {}) {
  const env = process.env;
  const base = {
    enabled: true,
    branch_prefix: 'acf',
    base_branch: 'auto',
    require_git_repo: true,
    auto_create_branch: true,
    auto_commit_on_success: true,
    auto_merge_on_success: true,
    delete_branch_after_merge: false,
    require_clean_start: false,
    ...(config.git_workflow || {})
  };
  return {
    ...base,
    enabled: env.ACF_GIT_WORKFLOW_ENABLED ? env.ACF_GIT_WORKFLOW_ENABLED !== 'false' : base.enabled,
    branch_prefix: env.ACF_GIT_BRANCH_PREFIX || base.branch_prefix,
    base_branch: env.ACF_GIT_BASE_BRANCH || base.base_branch,
    require_git_repo: env.ACF_GIT_REQUIRE_REPO ? env.ACF_GIT_REQUIRE_REPO !== 'false' : base.require_git_repo,
    auto_create_branch: env.ACF_GIT_AUTO_CREATE_BRANCH ? env.ACF_GIT_AUTO_CREATE_BRANCH !== 'false' : base.auto_create_branch,
    auto_commit_on_success: env.ACF_GIT_AUTO_COMMIT_ON_SUCCESS ? env.ACF_GIT_AUTO_COMMIT_ON_SUCCESS !== 'false' : base.auto_commit_on_success,
    auto_merge_on_success: env.ACF_GIT_AUTO_MERGE_ON_SUCCESS ? env.ACF_GIT_AUTO_MERGE_ON_SUCCESS !== 'false' : base.auto_merge_on_success
  };
}

function statusPath(root, requestId) {
  return aiPath(root, 'execution', 'status', `${requestId}-branch.json`);
}

function git(root, args, options = {}) {
  return runCommand('git', args, { cwd: root, timeout: options.timeout || 120000, env: options.env || process.env });
}

export function isGitRepo(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree'], { timeout: 30000 }).success;
}

export function hasAnyCommit(root) {
  return git(root, ['rev-parse', '--verify', 'HEAD'], { timeout: 30000 }).success;
}

export function currentBranch(root) {
  const branch = git(root, ['branch', '--show-current'], { timeout: 30000 });
  if (branch.success && branch.stdout.trim()) return branch.stdout.trim();
  const symbolic = git(root, ['symbolic-ref', '--short', 'HEAD'], { timeout: 30000 });
  if (symbolic.success && symbolic.stdout.trim()) return symbolic.stdout.trim();
  return null;
}

export function branchExists(root, branch) {
  if (!branch) return false;
  return git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { timeout: 30000 }).success;
}

export function detectBaseBranch(root, cfg = workflowConfig()) {
  if (cfg.base_branch && cfg.base_branch !== 'auto') return cfg.base_branch;
  const current = currentBranch(root);
  if (current && !current.startsWith(`${cfg.branch_prefix}/`)) return current;
  if (branchExists(root, 'main')) return 'main';
  if (branchExists(root, 'master')) return 'master';
  return current || 'main';
}

export function reqBranchName(requestId, title = '', cfg = workflowConfig()) {
  // Deaccent before slugging: "sección" must become "seccion", not "secci-n"
  // with a hole where the ó was (real branch: acf/req-004-agreg-una-secci-n-...).
  const slug = String(title || 'request')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'request';
  return `${cfg.branch_prefix}/${requestId.toLowerCase()}-${slug}`;
}

export function workingTreeStatus(root) {
  const result = git(root, ['status', '--porcelain'], { timeout: 30000 });
  return result.success ? result.stdout.trim() : null;
}

export function ensureRequestBranch(root, requestId, config = {}) {
  const cfg = workflowConfig(config);
  if (!cfg.enabled || !cfg.auto_create_branch) {
    const skipped = { request_id: requestId, status: 'skipped', reason: 'git workflow disabled', updated_at: nowIso() };
    writeJson(statusPath(root, requestId), skipped);
    return skipped;
  }

  if (!isGitRepo(root)) {
    const failed = { request_id: requestId, status: 'failed', reason: 'git repository required before implementation', next_action: 'Run git init and create an initial commit, or run `npm run ai -- project-bootstrap`.', updated_at: nowIso() };
    writeJson(statusPath(root, requestId), failed);
    return failed;
  }

  if (!hasAnyCommit(root)) {
    const failed = { request_id: requestId, status: 'failed', reason: 'git repository has no commits; cannot create a safe request branch/merge workflow', next_action: 'Create an initial commit first, or run `npm run ai -- project-bootstrap`.', updated_at: nowIso() };
    writeJson(statusPath(root, requestId), failed);
    return failed;
  }

  const req = loadRequest(root, requestId) || { title: requestId };
  const existing = readJsonSafe(statusPath(root, requestId), null);
  const baseBranch = existing?.base_branch || detectBaseBranch(root, cfg);
  const branch = existing?.branch || reqBranchName(requestId, req.title, cfg);
  const current = currentBranch(root);

  if (cfg.require_clean_start) {
    const dirty = workingTreeStatus(root);
    if (dirty) {
      const failed = { request_id: requestId, status: 'failed', reason: 'working tree is not clean before request branch creation', dirty_preview: dirty.slice(0, 2000), updated_at: nowIso() };
      writeJson(statusPath(root, requestId), failed);
      return failed;
    }
  }

  let checkout;
  if (current === branch) {
    checkout = { success: true, stdout: `Already on ${branch}` };
  } else if (branchExists(root, branch)) {
    checkout = git(root, ['switch', branch]);
    if (!checkout.success) checkout = git(root, ['checkout', branch]);
  } else {
    checkout = git(root, ['switch', '-c', branch]);
    if (!checkout.success) checkout = git(root, ['checkout', '-b', branch]);
  }

  const state = {
    request_id: requestId,
    status: checkout.success ? 'on_request_branch' : 'failed',
    base_branch: baseBranch,
    branch,
    previous_branch: current,
    reason: checkout.success ? 'request branch ready' : (checkout.stderr_preview || checkout.error || 'failed to create/switch request branch'),
    stdout_preview: checkout.stdout_preview,
    stderr_preview: checkout.stderr_preview,
    updated_at: nowIso()
  };
  writeJson(statusPath(root, requestId), state);
  return state;
}

export function finalizeRequestBranch(root, requestId, config = {}) {
  const cfg = workflowConfig(config);
  const state = readJsonSafe(statusPath(root, requestId), null);
  if (!cfg.enabled || !cfg.auto_merge_on_success) return { request_id: requestId, status: 'skipped', reason: 'git workflow merge disabled' };
  if (!state || state.status === 'failed') return { request_id: requestId, status: 'failed', reason: state?.reason || 'request branch was not prepared' };
  if (!isGitRepo(root)) return { request_id: requestId, status: 'failed', reason: 'not a git repository' };

  const branch = state.branch;
  const base = state.base_branch || detectBaseBranch(root, cfg);
  const current = currentBranch(root);
  if (current !== branch) {
    const sw = git(root, ['switch', branch]);
    if (!sw.success) return writeAndReturn(root, requestId, { ...state, status: 'failed', reason: `could not switch back to request branch ${branch}`, stderr_preview: sw.stderr_preview, updated_at: nowIso() });
  }

  let commitResult = null;
  if (cfg.auto_commit_on_success) {
    git(root, ['add', '-A']);
    const status = workingTreeStatus(root);
    if (status) {
      const req = loadRequest(root, requestId) || { title: requestId };
      const msg = `${requestId}: ${String(req.title || 'AI Code Factory changes').slice(0, 80)}`;
      commitResult = git(root, ['-c', 'user.name=AI Code Factory', '-c', 'user.email=ai-code-factory@example.local', 'commit', '-m', msg]);
      if (!commitResult.success) {
        return writeAndReturn(root, requestId, { ...state, status: 'failed', phase: 'commit', reason: commitResult.stderr_preview || commitResult.error || 'commit failed', updated_at: nowIso() });
      }
    }
  }

  let checkoutBase = git(root, ['switch', base]);
  if (!checkoutBase.success) checkoutBase = git(root, ['checkout', base]);
  if (!checkoutBase.success) {
    return writeAndReturn(root, requestId, { ...state, status: 'failed', phase: 'checkout_base', reason: checkoutBase.stderr_preview || checkoutBase.error || `could not switch to ${base}`, updated_at: nowIso() });
  }

  const merge = git(root, ['-c', 'user.name=AI Code Factory', '-c', 'user.email=ai-code-factory@example.local', 'merge', '--no-ff', '--no-edit', branch]);
  if (!merge.success) {
    return writeAndReturn(root, requestId, { ...state, status: 'failed', phase: 'merge', reason: merge.stderr_preview || merge.error || 'merge failed', updated_at: nowIso() });
  }

  if (cfg.delete_branch_after_merge) git(root, ['branch', '-d', branch]);
  return writeAndReturn(root, requestId, {
    ...state,
    status: 'merged',
    merged_to: base,
    commit_created: Boolean(commitResult?.success),
    merge_stdout_preview: merge.stdout_preview,
    merge_stderr_preview: merge.stderr_preview,
    updated_at: nowIso()
  });
}

function writeAndReturn(root, requestId, value) {
  writeJson(statusPath(root, requestId), value);
  return value;
}

export function gitWorkflowStatus(root, requestId = null) {
  if (requestId) return readJsonSafe(statusPath(root, requestId), null) || { request_id: requestId, status: 'missing' };
  return {
    git_repo: isGitRepo(root),
    has_commits: isGitRepo(root) ? hasAnyCommit(root) : false,
    current_branch: isGitRepo(root) ? currentBranch(root) : null,
    status: isGitRepo(root) ? workingTreeStatus(root) : null
  };
}
