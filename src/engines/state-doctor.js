import { exists, readJson } from '../core/fs.js';
import { aiPath, requestPaths } from '../core/paths.js';
import { listBacklog } from '../core/state.js';
import { deriveStateFromEvents } from '../core/events.js';

export function runStateDoctor(root) {
  const issues = [];
  const state = readJson(aiPath(root, 'state.json'), {});
  const backlog = listBacklog(root);
  // A fresh project with an empty backlog has no active request BY DESIGN —
  // flagging it scared users right after `setup`. Only a dangling state
  // (backlog has requests but no pointer) is a real inconsistency.
  if (!state.active_request_id && backlog.length > 0) issues.push(issue('no-active-request', 'Backlog has requests but no active request is selected.', 'Run ask or set active request.'));

  for (const req of backlog) {
    const paths = requestPaths(root, req.id);
    if (!exists(paths.intake)) issues.push(issue('missing-intake', `${req.id} missing intake analysis.`, 'Run fix-intake.'));
    if (!exists(paths.contextPack)) issues.push(issue('missing-context-pack', `${req.id} missing context pack.`, 'Run context-pack.'));
    if (!exists(paths.gates)) issues.push(issue('missing-gates', `${req.id} missing gates.`, 'Run gate-check.'));
    if (req.work_type === 'frontend_visual' && req.status === 'done' && !exists(paths.visualReview)) {
      issues.push(issue('visual-done-without-review', `${req.id} is done without visual review.`, 'Reopen or add visual evidence.'));
    }
    if (req.status === 'done') {
      const gates = exists(paths.gates) ? readJson(paths.gates, null) : null;
      if (gates && !gates.close_allowed) issues.push(issue('done-but-gates-blocked', `${req.id} marked done but close gate is blocked.`, 'Reopen or resolve blockers.'));
    }
    const execution = exists(paths.executionStatus) ? readJson(paths.executionStatus, null) : null;
    if (execution && execution.status === 'failed' && (execution.files_touched || []).length) {
      issues.push(issue('failed-exec-touched-files', `${req.id} executor failed but touched ${execution.files_touched.length} files.`, 'Review the diff; revert or fix before continuing.'));
    }
    if (execution?.timed_out) issues.push(issue('exec-timed-out', `${req.id} executor timed out.`, 'Split the contract or raise execution.timeout_ms.'));
  }

  // Cross-check backlog files against the append-only event log.
  const derived = deriveStateFromEvents(root);
  for (const [requestId, eventState] of Object.entries(derived.requests)) {
    const req = backlog.find((r) => r.id === requestId);
    if (!req) {
      issues.push(issue('event-without-backlog', `Events exist for ${requestId} but the backlog file is missing.`, 'Restore the backlog file or mark the REQ superseded.'));
      continue;
    }
    if (eventState.closed && req.status !== 'done') {
      issues.push(issue('event-close-mismatch', `${requestId} has REQ_CLOSED event but backlog status is ${req.status}.`, 'Align status or investigate the close event.'));
    }
    if (req.status === 'done' && !eventState.closed) {
      issues.push(issue('backlog-close-mismatch', `${requestId} is done in backlog but has no REQ_CLOSED event.`, 'Re-run gate-check/approve flow to record proper close.'));
    }
    if (eventState.visual_accepted && req.work_type === 'frontend_visual' && !exists(requestPaths(root, requestId).visualReview)) {
      issues.push(issue('visual-event-without-artifact', `${requestId} has VISUAL_ACCEPTED event but the visual review artifact is missing.`, 'Regenerate visual review.'));
    }
  }

  return { status: issues.length ? 'issues_found' : 'healthy', issues, event_requests: Object.keys(derived.requests).length };
}

function issue(id, message, fix) { return { id, message, fix }; }
