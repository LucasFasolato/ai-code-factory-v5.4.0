import { aiPath, requestPaths } from '../core/paths.js';
import { exists, readText, readJson, readJsonSafe, writeJson, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { commandExists, runCommand, parseShellLikeCommand, shouldSkipNpmRun, gitChangedFiles } from '../core/command-runner.js';
import { saveExecutionContract } from './execution-contract-engine.js';
import { appendEvent } from '../core/events.js';
import { buildExecutorEnv } from './executor-auth.js';
import { budgetText, ARGV_SAFE_LIMIT } from '../core/prompt-budget.js';

export function runExecutor(root, requestId, config = {}, options = {}) {
  const paths = requestPaths(root, requestId);
  if (!exists(paths.contract)) saveExecutionContract(root, requestId);
  const fullContract = readText(paths.contract, '');
  const instruction = buildExecutorInstruction(root, requestId, paths.contract, fullContract);
  const executionConfig = config.execution || {};
  const primary = executionConfig.primary || 'codex';
  const startedAt = nowIso();
  const filesBefore = gitChangedFiles(root);
  appendEvent(root, 'EXECUTION_STARTED', { request_id: requestId, executor: primary, dry_run: Boolean(options.dryRun) });
  let result;

  if (options.dryRun || executionConfig.enabled === false) {
    result = dryRunStatus(requestId, 'Execution disabled or dry-run requested.', startedAt);
  } else if (primary === 'codex' && commandExists(executionConfig.codex?.command || 'codex')) {
    result = runCodex(root, requestId, instruction, executionConfig);
  } else if (primary !== 'codex' && commandExists(primary)) {
    result = runGeneric(root, requestId, primary, [instruction], executionConfig.timeout_ms);
  } else if (executionConfig.fallback && commandExists(executionConfig.claude?.command || 'claude')) {
    result = runClaude(root, requestId, instruction, executionConfig);
  } else if (executionConfig.dry_run_when_missing_executor !== false) {
    result = dryRunStatus(requestId, `Executor missing: ${primary}. Recorded dry-run instead of pretending success.`, startedAt);
  } else {
    result = { request_id: requestId, status: 'failed', reason: `Executor missing: ${primary}`, started_at: startedAt, ended_at: nowIso() };
  }

  const filesAfter = gitChangedFiles(root);
  result.files_touched = diffChangedFiles(filesBefore, filesAfter);

  // v4.6 honest-success guard: a Codex/Claude run that exits 0 but touched no
  // files when implementation was clearly expected is NOT a real success — it
  // usually means the agent gave up, hit a sandbox limit, or only printed a
  // plan. Mirror the design engine's "verify the artifact, not the exit code"
  // discipline so the gate engine cannot be fooled by a clean exit.
  if (result.status === 'success' && !options.dryRun) {
    const expectsFiles = intentExpectsFileChanges(root, requestId);
    const touchedNothing = Array.isArray(result.files_touched) && result.files_touched.length === 0;
    if (expectsFiles && touchedNothing) {
      result.status = 'no_op';
      result.reason = 'Executor exited 0 but produced no file changes while implementation was expected. Treated as no-op, not success.';
      result.honest_success_guard = 'tripped';
    } else {
      result.honest_success_guard = 'passed';
    }
  }

  writeExecutionArtifacts(root, requestId, result);
  appendEvent(root, 'EXECUTION_FINISHED', { request_id: requestId, executor: result.executor, status: result.status, files_touched: result.files_touched });
  return result;
}

export function runTechnicalValidation(root, requestId, config = {}) {
  const commands = config.validation?.commands || [];
  const skipMissing = config.validation?.skip_missing_scripts !== false;
  appendEvent(root, 'VALIDATION_STARTED', { request_id: requestId, commands });
  const results = [];
  for (const commandLine of commands) {
    if (shouldSkipNpmRun(root, commandLine, skipMissing)) {
      results.push({ command_line: commandLine, status: 'skipped', reason: 'missing package script', success: true });
      continue;
    }
    const parsed = parseShellLikeCommand(commandLine);
    if (!parsed.command) continue;
    const result = runCommand(parsed.command, parsed.args, { cwd: root, timeout: config.execution?.timeout_ms || 900000 });
    results.push({ command_line: commandLine, status: result.success ? 'passed' : 'failed', success: result.success, exit_code: result.status, timed_out: result.timed_out, stdout_preview: result.stdout_preview, stderr_preview: result.stderr_preview });
  }
  const executed = results.filter((r) => r.status !== 'skipped');
  const failed = results.filter((r) => r.status === 'failed');
  const status = failed.length ? 'failed' : (executed.length ? 'passed' : 'skipped');
  const validation = { request_id: requestId, status, commands: results, generated_at: nowIso() };
  writeJson(requestPaths(root, requestId).validation, validation);
  appendEvent(root, 'VALIDATION_FINISHED', { request_id: requestId, status });
  return validation;
}

// Builds the executor invocation as { command, args[], shell:false }.
// KF-005 regression: Codex MUST be invoked as `codex exec ... -C <root> "<instruction>"`
// with an args array and shell:false (Windows-safe, no stdin terminal issues).
// Builds the executor invocation. CRITICAL: the full contract is NEVER inlined
// into argv — that is what overflows the OS command-line limit (Windows ~32 KB)
// and breaks Codex/Claude. Instead we pass a short, bounded instruction that
// points the agent at the contract file on disk, which it reads itself.
export function buildExecutorCommand(executor, config = {}, root, instruction, opts = {}) {
  const executionConfig = config.execution || config || {};
  const safeInstruction = budgetText(instruction, ARGV_SAFE_LIMIT);
  if (executor === 'codex') {
    const codex = executionConfig.codex || { command: 'codex', args: ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--config', 'approval_policy="never"', '-C'] };
    let codexArgs = ensureCodexSafeArgs(codex.args || []);
    codexArgs = ensureReasoningEffort(codexArgs, opts.reasoningEffort, executionConfig);
    return { command: codex.command || 'codex', args: [...codexArgs, root, safeInstruction], shell: false };
  }
  if (executor === 'claude') {
    const claude = executionConfig.claude || { command: 'claude', args: ['-p'] };
    return { command: claude.command || 'claude', args: [...(claude.args || []), safeInstruction], shell: false };
  }
  return { command: executor, args: [safeInstruction], shell: false };
}


// v5.4: the thinking orchestrator decides how hard the executor thinks.
// A trivial copy change does not deserve xhigh reasoning (minutes per step,
// timeouts, wasted tokens); a payments refactor does not deserve low.
// Explicit user flags always win; execution.adaptive_reasoning=false disables.
export function reasoningEffortFor(intake = {}) {
  const risk = intake.risk || 'medium';
  const difficulty = intake.difficulty || 'medium';
  if (risk === 'high' || ['complex', 'epic'].includes(difficulty)) return 'high';
  if (risk === 'low' && ['trivial', 'simple'].includes(difficulty)) return 'low';
  return 'medium';
}

function ensureReasoningEffort(args, effort, executionConfig = {}) {
  if (!effort) return args;
  if (executionConfig.adaptive_reasoning === false) return args;
  if (args.some((a) => String(a).includes('model_reasoning_effort'))) return args; // user pinned it
  const out = [...args];
  const cIndex = out.indexOf('-C');
  const insertAt = cIndex >= 0 ? cIndex : out.length;
  out.splice(insertAt, 0, '--config', `model_reasoning_effort="${effort}"`);
  return out;
}

function ensureCodexSafeArgs(args = []) {
  const out = [...args];
  if (!out.includes('exec')) out.unshift('exec');
  if (!out.includes('--skip-git-repo-check')) {
    const cIndex = out.indexOf('-C');
    const insertAt = cIndex >= 0 ? cIndex : out.length;
    out.splice(insertAt, 0, '--skip-git-repo-check');
  }
  return out;
}

// A compact instruction that delegates the heavy content to the on-disk contract.
// This is what keeps argv small no matter how large the real contract grows.
function buildExecutorInstruction(root, requestId, contractFile, fullContract) {
  const rel = contractFile.replace(`${root}/`, '').replace(`${root}\\`, '');
  const goalLine = (fullContract.match(/## Goal\s*\n+([^\n]+)/) || [])[1] || 'Implement the approved request.';
  return [
    'You are the AI Code Factory implementation executor.',
    `Your full execution contract is on disk at: ${rel}`,
    'Read that file first; it contains the goal, allowed files, forbidden actions, locked constraints and context.',
    '',
    `Goal (summary): ${goalLine}`,
    '',
    'Hard rules:',
    '- Implement ONLY within the allowed files / scope stated in the contract.',
    '- Do not invent real contact data, metrics or business facts; use explicit placeholders.',
    '- Do not change auth/db/payment behavior unless the contract explicitly allows it.',
    '- Write clean, well-structured code following the project conventions and patterns.',
    '- Report the files you changed. Do not claim done unless the work is real.'
  ].join('\n');
}

function runCodex(root, requestId, instruction, executionConfig) {
  const intake = readJsonSafe(requestPaths(root, requestId).intake, {});
  const built = buildExecutorCommand('codex', { execution: executionConfig }, root, instruction, { reasoningEffort: reasoningEffortFor(intake) });
  const executorEnv = buildExecutorEnv({ execution: executionConfig });
  const result = runCommand(built.command, built.args, { cwd: root, timeout: executionConfig.timeout_ms || 900000, env: executorEnv.env });
  return { ...normalizeRunResult(requestId, 'codex', result), auth_mode: executorEnv.policy.mode, api_env_removed: executorEnv.removed, instruction_chars: built.args[built.args.length - 1].length };
}

function runClaude(root, requestId, instruction, executionConfig) {
  const built = buildExecutorCommand('claude', { execution: executionConfig }, root, instruction);
  const executorEnv = buildExecutorEnv({ execution: executionConfig });
  const result = runCommand(built.command, built.args, { cwd: root, timeout: executionConfig.timeout_ms || 900000, env: executorEnv.env });
  return { ...normalizeRunResult(requestId, 'claude', result), auth_mode: executorEnv.policy.mode, api_env_removed: executorEnv.removed, instruction_chars: built.args[built.args.length - 1].length };
}

function runGeneric(root, requestId, command, args, timeout) {
  const result = runCommand(command, args, { cwd: root, timeout: timeout || 900000 });
  return normalizeRunResult(requestId, command, result);
}

function normalizeRunResult(requestId, executor, result) {
  return {
    request_id: requestId,
    executor,
    status: result.success ? 'success' : 'failed',
    reason: result.success ? 'Executor completed.' : (result.timed_out ? 'Executor timed out.' : (result.error || 'Executor returned non-zero exit code.')),
    exit_code: result.status,
    signal: result.signal,
    timed_out: result.timed_out,
    stdout_preview: result.stdout_preview,
    stderr_preview: result.stderr_preview,
    started_at: result.started_at,
    ended_at: result.ended_at
  };
}

function dryRunStatus(requestId, reason, startedAt) {
  return {
    request_id: requestId,
    executor: 'dry-run',
    status: 'dry_run',
    reason,
    exit_code: null,
    stdout_preview: '',
    stderr_preview: '',
    started_at: startedAt,
    ended_at: nowIso()
  };
}

function diffChangedFiles(before, after) {
  if (!after) return null; // git unavailable
  const prev = new Set(before || []);
  return after.filter((f) => !prev.has(f));
}

// Whether the intake implies the executor should actually write code. Pure
// planning/epic work, or runs where git is unavailable (files_touched === null),
// are exempt so we never raise a false alarm.
function intentExpectsFileChanges(root, requestId) {
  const intake = readJson(requestPaths(root, requestId).intake, null);
  if (!intake) return false;
  if (intake.should_implement_now === false) return false;
  if (intake.requires_decomposition || intake.work_type === 'product_epic') return false;
  const implementingTypes = ['frontend_visual', 'backend_api', 'fullstack_feature', 'small_change', 'bugfix', 'refactor'];
  return implementingTypes.includes(intake.work_type);
}

function writeExecutionArtifacts(root, requestId, result) {
  const paths = requestPaths(root, requestId);
  writeJson(paths.executionStatus, result);
  const logFile = aiPath(root, 'execution', 'logs', `${requestId}-${Date.now()}-${result.executor || 'executor'}.log`);
  result.log_path = logFile;
  writeText(logFile, `# Execution Log ${requestId}\n\n${JSON.stringify(result, null, 2)}\n`);
}
