import { requestPaths, aiPath } from '../core/paths.js';
import { exists, readJson, readText } from '../core/fs.js';
import { loadState, loadRequest, listBacklog } from '../core/state.js';
import { readProgress } from './progress-engine.js';

// v5.3 Guide — the answer to "what do I do now?". A tool is obvious when it
// always states the next command; this reads the REAL state of the active REQ
// (intake, execution, gates, visual) and computes exactly that. Read-only,
// zero tokens, instant.

export function buildGuide(root, config = {}) {
  const state = loadState(root);
  const active = state.active_request_id;

  if (!active) {
    const backlog = listBacklog(root).filter((r) => r.status !== 'done');
    if (backlog.length) {
      return guide('backlog_waiting', `No active REQ. ${backlog.length} open in backlog.`, [
        cmd(`set-active ${backlog[0].id}`, `resume ${backlog[0].id} — ${short(backlog[0].title)}`),
        cmd('start "..."', 'or start something new')
      ]);
    }
    return guide('idle', 'Nothing in flight. The factory is ready.', [
      cmd('start "tu pedido en lenguaje natural"', 'create your first requirement'),
      cmd('stats', 'see how past work went')
    ]);
  }

  const req = loadRequest(root, active) || {};
  const paths = requestPaths(root, active);
  const intake = readJson(paths.intake, {}) || {};
  const execution = readJson(paths.executionStatus, null);
  const gates = exists(paths.gates) ? readJson(paths.gates, null) : null;
  const blockers = gates?.close_blockers || [];
  const title = short(req.title || intake.interpreted_intent || active);
  const head = `${active} — ${title}`;

  // 1. Done
  if (req.status === 'done' || gates?.close_allowed === true) {
    return guide('done', `${head}\nStage: ✅ completed and merged.`, [
      cmd('start "..."', 'next requirement'),
      cmd(`progress ${active}`, 'see the full story of this one')
    ], active);
  }

  // 2. Brain degraded
  if (intake.brain_required_but_unavailable || intake.brain?.brain_degraded) {
    return guide('brain_degraded', `${head}\nStage: ⛔ the thinking brain (Claude) was unavailable — decision is heuristic-only.`, [
      cmd('brain-doctor', 'diagnose Claude availability'),
      cmd(`ask "${short(req.title, 60)}"`, 're-run the ask once Claude is back')
    ], active);
  }

  // 3. Blocking questions unanswered
  const blocking = intake.blocking_missing_info || [];
  const answers = readText(paths.answersMd, '').trim();
  if (req.status === 'needs_input' && blocking.length && !answers) {
    return guide('needs_answers', `${head}\nStage: 🧠 the brain asked before implementing:\n${blocking.map((q) => `   ? ${q}`).join('\n')}`, [
      cmd(`answer ${active} "tu respuesta"`, 'answers are injected into the executor contract'),
      cmd('continue', 'then run the cycle')
    ], active);
  }

  // 4. Design-first pending — only relevant BEFORE execution; once implemented
  // (e.g. via override-workflow), the visual gate is the honest state.
  if (intake.design_first_required && !exists(paths.approvedDesign) && !execution) {
    return guide('design_pending', `${head}\nStage: 🎨 design-first work without an approved design.`, [
      cmd('design-generate --all', 'generate design options'),
      cmd(`override-workflow ${active} direct-patch-with-validation`, 'OR skip design for a simple change')
    ], active);
  }

  // 5. Not executed yet
  if (!execution) {
    return guide('ready_to_run', `${head}\nStage: 📋 intake ready, nothing executed yet.`, [
      cmd('continue', 'run the full cycle (branch → implement → validate → gates)')
    ], active);
  }

  // 6. Execution failed
  if (execution.status !== 'success') {
    const timedOut = execution.timed_out || /timed? ?out/i.test(execution.reason || '');
    return guide('execution_failed', `${head}\nStage: ⛔ executor ${timedOut ? 'timed out' : `failed (${execution.reason || execution.status})`}.${execution.log_path ? `\n   Log: ${execution.log_path}` : ''}`, [
      cmd('continue --force-execute', timedOut ? 'retry (close other Codex sessions first — parallel sessions throttle your account)' : 'retry the implementation'),
      ...(timedOut ? [cmd('config: raise execution.timeout_ms in .ai/config.json', 'if the task is genuinely long')] : [])
    ], active);
  }

  // 7. Implemented — what blocks the close?
  const visualPending = blockers.some((b) => /visual_evidence/i.test(b));
  if (visualPending) {
    return guide('awaiting_visual', `${head}\nStage: 👀 implemented and validated — a human must look at it before closing.`, [
      cmd('npm run dev', 'open it in the browser (run in the project, not the harness)'),
      cmd('accept', 'if it looks right: visual-accept + resume + merge in one verb')
    ], active);
  }

  const approvalPending = blockers.length === 0 && (intake.risk === 'high' || intake.requires_human_approval);
  if (approvalPending) {
    return guide('awaiting_approval', `${head}\nStage: ✋ ${intake.risk === 'high' ? 'high-risk' : 'approval-required'} work implemented on its branch (draft), awaiting your review.`, [
      cmd('review', 'the decision packet: diff, gates, cost'),
      cmd('continue --approved', 'merge it')
    ], active);
  }

  if (blockers.length) {
    return guide('blocked', `${head}\nStage: 🚧 gates blocked:\n${blockers.map((b) => `   ✕ ${b}`).join('\n')}`, [
      cmd('review', 'full picture of what blocks and why'),
      cmd('continue', 'resume once resolved')
    ], active);
  }

  // 8. Implemented, no gate snapshot yet
  return guide('in_progress', `${head}\nStage: ⚙️ implemented (${(execution.files_touched || []).length} file(s)) — gates not evaluated yet.`, [
    cmd('continue', 'resume: validate → gates → merge')
  ], active);
}

export function renderGuide(g) {
  const lines = [g.headline, ''];
  lines.push('Next:');
  for (const c of g.next) lines.push(`  ${c.command.startsWith('npm ') || c.command.startsWith('config:') ? c.command : `npm run ai -- ${c.command}`}${c.why ? `   # ${c.why}` : ''}`);
  return lines.join('\n');
}

function guide(stage, headline, next, requestId = null) {
  return { stage, headline, next, request_id: requestId };
}

function cmd(command, why = '') {
  return { command, why };
}

function short(text, max = 70) {
  const s = String(text || '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
