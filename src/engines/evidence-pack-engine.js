import { exists, readJson, writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { bullet } from '../core/format.js';
import { appendEvent } from '../core/events.js';

export function generateEvidencePack(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const validation = exists(paths.validation) ? readJson(paths.validation, null) : null;
  const acceptance = exists(paths.acceptance) ? readJson(paths.acceptance, null) : null;
  const gates = exists(paths.gates) ? readJson(paths.gates, null) : null;
  const execution = exists(paths.executionStatus) ? readJson(paths.executionStatus, null) : null;
  const approved = exists(paths.approvedDesign) ? readJson(paths.approvedDesign, null) : null;

  const md = `# Evidence Pack — ${requestId}\n\n` +
    `## Summary\n\n- Work type: ${intake.work_type}\n- Workflow: ${intake.recommended_workflow}\n- Close allowed: ${gates?.close_allowed ? 'yes' : 'no'}\n\n` +
    `## Technical Validation\n\n${validationSummary(validation)}\n\n` +
    `## Product Validation\n\n${acceptance ? `- ${acceptance.summary}` : '- Acceptance not evaluated.'}\n\n` +
    `## Design / Visual\n\n${approved ? `- Approved design: ${approved.approved_design}` : '- No approved design.'}\n${gates?.gates?.visual_evidence ? `- Visual evidence gate: ${gates.gates.visual_evidence.status}` : '- Visual gate missing.'}\n\n` +
    `## Safety\n\n${gates?.gates?.fake_data ? `- Fake data gate: ${gates.gates.fake_data.status} — ${gates.gates.fake_data.reason}` : '- Fake data gate missing.'}\n${gates?.gates?.locked_constraints ? `- Locked constraints gate: ${gates.gates.locked_constraints.status} — ${gates.gates.locked_constraints.reason}` : ''}\n\n` +
    `## Execution\n\n${executionSummary(execution)}\n\n` +
    `## Close Blockers\n\n${bullet(gates?.close_blockers || [])}\n`;
  writeText(paths.evidence, md);
  appendEvent(root, 'EVIDENCE_CREATED', { request_id: requestId, close_allowed: Boolean(gates?.close_allowed) });
  return { request_id: requestId, close_allowed: Boolean(gates?.close_allowed), path: paths.evidence, markdown: md };
}

function validationSummary(validation) {
  if (!validation) return '- Validation not run.';
  return (validation.commands || []).map((cmd) => `- ${cmd.command_line}: ${cmd.status}`).join('\n') || `- Status: ${validation.status}`;
}

function executionSummary(execution) {
  if (!execution) return '- Executor not run.';
  const lines = [
    `- Executor: ${execution.executor}`,
    `- Status: ${execution.status}`,
    `- Reason: ${execution.reason}`
  ];
  if (execution.timed_out) lines.push('- Timed out: yes');
  if (Array.isArray(execution.files_touched) && execution.files_touched.length) {
    lines.push(`- Files touched (${execution.files_touched.length}):`);
    for (const f of execution.files_touched.slice(0, 30)) lines.push(`  - ${f}`);
  }
  return lines.join('\n');
}
