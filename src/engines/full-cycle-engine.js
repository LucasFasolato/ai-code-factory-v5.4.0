import { requestPaths } from '../core/paths.js';
import { exists, readJson, readJsonSafe, readText } from '../core/fs.js';
import { appendProgress } from './progress-engine.js';
import { runHook } from './hooks-engine.js';
import { loadRequest, updateRequest } from '../core/state.js';
import { appendEvent } from '../core/events.js';
import { saveContextPack } from './context-pack-engine.js';
import { saveExecutionContract } from './execution-contract-engine.js';
import { runExecutor, runTechnicalValidation } from './executor-orchestrator.js';
import { evaluateAcceptance } from './acceptance-evaluator.js';
import { runSelfReview } from './self-review-engine.js';
import { generateEvidencePack } from './evidence-pack-engine.js';
import { generateLearning } from './learning-engine.js';
import { evaluateGates } from './gate-engine.js';
import { autoIterate } from './auto-iteration-engine.js';
import { ensureRequestBranch, finalizeRequestBranch, detectBaseBranch } from './git-workflow.js';

// Runs the full engineering cycle for an already-approved, brain-decided REQ:
//   contract → execute (Codex) → validate → acceptance → self-review →
//   gates → (auto-iterate on failure) → evidence → learn
// It is brain-first and gate-respecting: it stops at the first safety stop
// (degraded brain, design-first not approved, human-approval required, epic),
// never fakes progress, and never closes a REQ whose gates are blocked.

export function runFullCycle(root, requestId, config = {}, options = {}) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  const req = loadRequest(root, requestId);
  if (!intake || !req) throw new Error(`Request not ready: ${requestId}`);

  const steps = [];
  const stop = (reason, next) => ({ request_id: requestId, status: 'stopped', stopped_reason: reason, next_action: next, steps });
  const record = (name, detail) => {
    steps.push({ step: name, detail, at: Date.now() });
    appendProgress(root, requestId, name, detail); // resume-awareness: v5.2 progress file
  };

  // --- Safety stops (brain-first, gate-respecting) ---
  // v5.1.3: if the brain asked BLOCKING questions and they are unanswered, the
  // cycle must not implement on guesses — that is exactly the "prompt coding"
  // this harness exists to prevent. (Live run: status needs_input, cycle ran
  // anyway, Codex implemented an unspecified submission behavior.)
  const answersText = readText(paths.answersMd, '');
  const blockingQuestions = intake.blocking_missing_info || [];
  if (req.status === 'needs_input' && blockingQuestions.length && !answersText.trim()) {
    return stop(
      `The brain asked blocking question(s) before implementing: ${blockingQuestions.join(' | ')}`,
      `Answer with \`npm run ai -- answer ${requestId} "..."\`, then re-run cycle. Answers are injected into the executor contract.`
    );
  }
  if (intake.brain_required_but_unavailable || intake.brain?.brain_degraded) {
    return stop('Thinking brain (Claude) was unavailable; decision is heuristic-only.', 'Run brain-doctor, restore Claude, re-run ask, then cycle again.');
  }
  if (intake.requires_decomposition || intake.work_type === 'product_epic') {
    return stop('This is a product epic and must be decomposed into child REQs.', 'Create/ask the first child REQ.');
  }
  if (intake.design_first_required && !exists(paths.approvedDesign)) {
    return stop('Design-first work requires an approved design before implementation.', 'design-generate → design-preview → design-approve.');
  }
  if (intake.requires_human_approval && !options.humanApproved && req.status !== 'design_approved') {
    return stop('This work needs explicit human approval before execution.', 'Re-run cycle with --approved after reviewing the plan, or approve via dashboard.');
  }

  // --- Git branch gate: every implementing REQ runs on an isolated request branch. ---
  const branch = ensureRequestBranch(root, requestId, config);
  record('branch', { status: branch.status, branch: branch.branch, base: branch.base_branch });
  if (branch.status === 'failed') {
    return { ...stop(`Git workflow blocked implementation: ${branch.reason}`, branch.next_action || 'Fix git workflow, then retry cycle.'), branch };
  }

  // --- Plan: ensure context pack + execution contract exist ---
  saveContextPack(root, requestId);
  saveExecutionContract(root, requestId);
  if (!['implementation_ready', 'design_approved'].includes(req.status)) {
    updateRequest(root, requestId, { status: 'implementation_ready', next_best_action: 'execute' });
  }
  record('plan', { contract: paths.contract });
  appendEvent(root, 'CYCLE_STARTED', { request_id: requestId, dry_run: Boolean(options.dryRun) });

  // --- Execute (Codex) ---
  // v5.1.2 resumability: re-running cycle on a REQ whose execution already
  // succeeded must NOT re-implement — Codex finds nothing to change and the
  // honest-success guard trips on already-finished work. Resume from
  // validation instead; --force-execute re-runs on purpose.
  const previousExecution = readJson(paths.executionStatus, null);
  const previousFiles = previousExecution?.files_touched || previousExecution?.files_changed || [];
  let execution;
  if (!options.forceExecute && previousExecution?.status === 'success' && previousFiles.length) {
    execution = previousExecution;
    record('execute', { status: 'resumed_previous_success', files: previousFiles, guard: 'skipped (already implemented)' });
  } else {
    // pre_execute gates ACTUAL execution — a resumed cycle (nothing to run)
    // must not be blocked by an execution-stage hook.
    const preHook = runHook(root, 'pre_execute', { request_id: requestId, work_type: intake.work_type, risk: intake.risk }, config);
    if (preHook.ran) record('hook:pre_execute', { status: preHook.blocked ? 'blocked' : 'passed', output: preHook.output.slice(0, 200) });
    if (preHook.blocked) {
      return stop(`pre_execute hook blocked the run: ${preHook.output || preHook.error || 'non-zero exit'}`, 'Fix the condition your hook enforces (or adjust .ai/hooks/pre_execute.js), then re-run cycle.');
    }
    execution = runExecutor(root, requestId, config, { dryRun: Boolean(options.dryRun) });
    record('execute', { status: execution.status, files: execution.files_touched, guard: execution.honest_success_guard });
    if (execution.status === 'dry_run') {
      return stop('Executor ran in dry-run (no real executor available or --dry-run).', 'Install/configure Codex, then cycle without --dry-run.');
    }
    if (execution.status === 'no_op') {
      return stop('Executor exited cleanly but changed nothing (honest-success guard).', 'Check Codex auth/sandbox and retry, or refine the contract.');
    }
    if (execution.status !== 'success') {
      const hint = execution.status === 'timeout' || /timed? ?out/i.test(execution.reason || '')
        ? `Executor timed out (limit: ${config.execution?.timeout_ms || 900000}ms). Raise execution.timeout_ms in .ai/config.json or split the REQ into smaller slices.`
        : 'Inspect the execution log, fix, retry with `cycle --force-execute`.';
      return { ...stop('Executor did not complete successfully.', `${hint}${execution.log_path ? ` Log: ${execution.log_path}` : ''}`), execution };
    }
  }

  // --- Validate (lint/typecheck/test/build) ---
  let validation = runTechnicalValidation(root, requestId, config);
  record('validate', { status: validation.status });

  // --- Auto-iterate on validation failure (bounded) ---
  const maxIter = Number(config.autonomy?.max_auto_iterations ?? config.autonomous_loop?.max_auto_iterations ?? 3);
  let iterations = 0;
  while (validation.status === 'failed' && options.autoFix !== false && iterations < maxIter) {
    iterations += 1;
    const iter = autoIterate(root, requestId, config, { attempt: iterations });
    record('auto_iterate', { attempt: iterations, status: iter?.status || 'attempted' });
    validation = runTechnicalValidation(root, requestId, config);
    record('revalidate', { attempt: iterations, status: validation.status });
  }
  if (validation.status === 'failed') {
    return { ...stop(`Technical validation still failing after ${iterations} auto-fix attempt(s).`, 'Inspect validation output and fix manually.'), validation };
  }

  const postValidateHook = runHook(root, 'post_validate', { request_id: requestId, status: validation.status }, config);
  if (postValidateHook.ran) record('hook:post_validate', { status: postValidateHook.error ? 'error' : 'ok' });

  // --- Acceptance + self-review ---
  const acceptance = evaluateAcceptance(root, requestId);
  record('acceptance', { close_allowed: acceptance.close_allowed });
  const selfReview = runSelfReview(root, requestId);
  record('self_review', { problems: selfReview.problems.length });

  // --- Gates: the single source of truth for "can we close" ---
  const gates = evaluateGates(root, requestId, config);
  record('gates', { close_allowed: gates.close_allowed, blockers: gates.close_blockers });
  if (!gates.close_allowed) {
    return { ...stop('Close gates are blocked.', 'Resolve blockers: ' + gates.close_blockers.join('; ')), gates };
  }

  // --- Evidence + learning, then merge the request branch back to base ---
  const evidence = generateEvidencePack(root, requestId);
  record('evidence', { path: paths.evidence });
  const learning = generateLearning(root, requestId, { apply: Boolean(options.applyLearning) });
  record('learn', { failure_classes: learning.classification?.classes?.map((c) => c.class) || [] });

  // v5.2 draft-commit: the branch IS the draft; the merge is the commit.
  // High-risk work stays on its branch until a human explicitly reviews the
  // diff and approves — validated code is not the same as approved code.
  if (intake.risk === 'high' && !options.humanApproved) {
    return stop(
      'High-risk change is implemented and validated on its branch (draft), awaiting explicit approval to merge (commit).',
      `Review the diff (git diff ${safeBaseBranch(root)}...HEAD), then re-run \`cycle --approved\` to merge.`
    );
  }
  const preMergeHook = runHook(root, 'pre_merge', { request_id: requestId, risk: intake.risk }, config);
  if (preMergeHook.ran) record('hook:pre_merge', { status: preMergeHook.blocked ? 'blocked' : 'passed' });
  if (preMergeHook.blocked) {
    return stop(`pre_merge hook blocked the merge: ${preMergeHook.output || preMergeHook.error || 'non-zero exit'}`, 'Fix the condition your hook enforces, then re-run cycle.');
  }

  const merge = finalizeRequestBranch(root, requestId, config);
  record('merge', { status: merge.status, branch: merge.branch, merged_to: merge.merged_to || merge.base_branch, phase: merge.phase });
  if (merge.status === 'failed') {
    return { ...stop(`Git merge workflow failed: ${merge.reason}`, 'Resolve git branch/merge issue, then retry or merge manually.'), merge };
  }

  updateRequest(root, requestId, { status: 'done', next_best_action: 'propose next feature' });
  appendEvent(root, 'CYCLE_COMPLETED', { request_id: requestId, iterations, branch_status: merge.status });

  return {
    request_id: requestId,
    status: 'completed',
    iterations,
    steps,
    execution: { status: execution.status, files_touched: execution.files_touched },
    validation: { status: validation.status },
    acceptance: { close_allowed: acceptance.close_allowed },
    gates: { close_allowed: gates.close_allowed },
    next_action: 'propose-features for the next high-value REQ'
  };
}

function safeBaseBranch(root) {
  try { return detectBaseBranch(root) || 'main'; } catch { return 'main'; }
}
