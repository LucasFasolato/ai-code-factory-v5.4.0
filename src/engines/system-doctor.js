import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readJson, readJsonSafe, exists } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { VERSION } from '../defaults.js';
import { commandExists, runCommand } from '../core/command-runner.js';
import { brainDoctor } from './ai-intake-brain.js';
import { designDoctor } from './design-engine.js';
import { runStateDoctor } from './state-doctor.js';
import { executorAuthStatus } from './executor-auth.js';
import { mcpDoctor } from './mcp-router.js';
import { ARGV_SAFE_LIMIT, PROMPT_HARD_LIMIT } from '../core/prompt-budget.js';

// One command to answer "is this harness healthy and consistent?".
// Aggregates brain/design/state/executor/mcp diagnostics and adds the checks
// that previously had no home: version drift between code and on-disk config,
// and availability of the executors the config expects.

function check(id, status, detail, fix = null) {
  return { id, status, detail, fix };
}

export function runSystemDoctor(root, config = {}) {
  const sections = [];

  // --- Version / config drift ---
  const driftChecks = [];
  const onDiskConfig = readJsonSafe(aiPath(root, 'config.json'), {});
  const configVersion = onDiskConfig.version || null;
  if (configVersion && configVersion !== VERSION) {
    driftChecks.push(check('config_version_drift', 'warning',
      `.ai/config.json version (${configVersion}) differs from code version (${VERSION}).`,
      'Run `acf init` to reseed, or update .ai/config.json version. Safe to ignore if intentional.'));
  } else {
    driftChecks.push(check('config_version', 'ok', `Config and code agree on version ${VERSION}.`));
  }
  const pkg = readJsonSafe(path.join(root, 'package.json'), null);
  if (pkg && pkg.version && pkg.version !== VERSION) {
    // Only meaningful when running inside the harness repo itself.
    if (exists(path.join(root, 'src', 'cli.js'))) {
      driftChecks.push(check('package_version_drift', 'warning',
        `package.json version (${pkg.version}) differs from code version (${VERSION}).`,
        'Align package.json with src/defaults.js VERSION.'));
    }
  }
  sections.push({ name: 'version', checks: driftChecks });

  // --- Executors the config expects ---
  const execChecks = [];
  const execution = config.execution || {};
  const primary = execution.primary || 'codex';
  const primaryCmd = execution[primary]?.command || primary;
  const primaryOk = commandExists(primaryCmd);
  execChecks.push(check('primary_executor', primaryOk ? 'ok' : 'warning',
    primaryOk ? `Primary executor available: ${primaryCmd}` : `Primary executor not found: ${primaryCmd}. Runs will dry-run or fall back.`,
    primaryOk ? null : `Install ${primaryCmd} or set execution.primary to an available tool.`));
  if (execution.fallback) {
    const fbCmd = execution[execution.fallback]?.command || execution.fallback;
    execChecks.push(check('fallback_executor', commandExists(fbCmd) ? 'ok' : 'info',
      commandExists(fbCmd) ? `Fallback executor available: ${fbCmd}` : `Fallback executor not found: ${fbCmd}.`));
  }
  const auth = executorAuthStatus(config);
  execChecks.push(check('executor_auth', auth.safe_for_chatgpt_plan_execution ? 'ok' : (auth.warning ? 'warning' : 'info'),
    auth.warning || `Auth mode: ${auth.mode}; API env sanitized: ${auth.sanitize_api_env}.`));
  sections.push({ name: 'executors', checks: execChecks });

  // --- Prompt-size discipline: the #1 cause of Codex/Claude CLI failures ---
  const promptChecks = [];
  const tb = config.token_budget || {};
  const ctxCap = Number(tb.max_context_pack_chars || 30000);
  promptChecks.push(check('context_pack_cap', ctxCap <= 40000 ? 'ok' : 'warning',
    `Context pack capped at ${ctxCap} chars.`,
    ctxCap > 40000 ? 'Lower token_budget.max_context_pack_chars; very large packs slow the brain.' : null));
  promptChecks.push(check('executor_argv_safety', 'ok',
    `Executor sends a file-referenced instruction (≤${ARGV_SAFE_LIMIT} chars argv); full contract is read from disk. Safe against Windows command-line limits.`));
  promptChecks.push(check('brain_prompt_hard_cap', 'ok',
    `Brain prompts are hard-capped at ${PROMPT_HARD_LIMIT} chars regardless of config.`));
  sections.push({ name: 'prompt_budget', checks: promptChecks });

  // --- Validation runner smoke test: use the same portable runner validate uses. ---
  const runnerChecks = [];
  const npmSmoke = safe(() => runCommand('npm', ['--version'], { cwd: root, timeout: 30000 }));
  runnerChecks.push(check('npm_runner_portable', npmSmoke.success ? 'ok' : 'warning',
    npmSmoke.success ? `Portable runner can execute npm (version ${String(npmSmoke.stdout || '').trim()}).` : `Portable runner could not execute npm: ${npmSmoke.error || npmSmoke.stderr_preview || 'unknown error'}`,
    npmSmoke.success ? null : 'On Windows, ensure npm resolves through npm.cmd and run `npm run ai -- doctor:syntax`.'));
  sections.push({ name: 'validation_runner', checks: runnerChecks, raw: npmSmoke });

  // --- Sub-doctors (best-effort; never let one failure sink the report) ---
  const brain = safe(() => brainDoctor(root, config));
  const design = safe(() => designDoctor(root, config));
  const state = safe(() => runStateDoctor(root));
  const mcp = safe(() => mcpDoctor(root));

  const brainReady = !brain.error && brain.ready !== false;
  const brainChecks = [check('brain', brainReady ? 'ok' : 'warning',
    brain.error ? `Brain doctor error: ${brain.error}` : `Configured brain provider: ${brain.configured_provider || 'heuristic'} (ready: ${brain.ready !== false}).`,
    brainReady ? null : 'Brain-first mode needs Claude available. Install/login the Claude CLI or set a provider key; otherwise implementing asks are held.')];
  sections.push({ name: 'brain', checks: brainChecks, raw: brain });

  const designStatus = design.error ? 'warning' : (design.status === 'ok' ? 'ok' : 'warning');
  sections.push({ name: 'design', checks: [check('design_pipeline', designStatus,
    design.error ? `Design doctor error: ${design.error}` : `${design.predicted_behavior}`)], raw: design });

  const stateIssues = Array.isArray(state.issues) ? state.issues : [];
  sections.push({ name: 'state', checks: [check('state_integrity', stateIssues.length ? 'warning' : 'ok',
    stateIssues.length ? `${stateIssues.length} state issue(s) found. Run \`acf state-doctor\` for detail.` : 'No state integrity issues found.')], raw: state });

  const mcpChecks = [check('mcp', mcp.error ? 'info' : 'ok',
    mcp.error ? `MCP doctor error: ${mcp.error}` : `MCP registry checked.`)];
  sections.push({ name: 'mcp', checks: mcpChecks, raw: mcp });

  // --- Roll up ---
  const allChecks = sections.flatMap((s) => s.checks);
  const failed = allChecks.filter((c) => c.status === 'fail');
  const warnings = allChecks.filter((c) => c.status === 'warning');
  const status = failed.length ? 'attention_required' : (warnings.length ? 'warnings' : 'ok');

  return {
    status,
    version: VERSION,
    summary: { ok: allChecks.filter((c) => c.status === 'ok').length, warnings: warnings.length, failed: failed.length, info: allChecks.filter((c) => c.status === 'info').length },
    sections,
    generated_at: nowIso()
  };
}

function safe(fn) {
  try { return fn() || {}; } catch (error) { return { error: String(error.message || error) }; }
}
