import { exists, readJson, readJsonSafe, writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { bullet } from '../core/format.js';

export function runSelfReview(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const validation = exists(paths.validation) ? readJsonSafe(paths.validation, null) : null;
  const acceptance = exists(paths.acceptance) ? readJsonSafe(paths.acceptance, null) : null;
  const gates = exists(paths.gates) ? readJsonSafe(paths.gates, null) : null;

  const problems = [];
  if (!validation || validation.status !== 'passed') problems.push('Technical validation is not passed.');
  if (!acceptance || !acceptance.close_allowed) problems.push('Acceptance criteria are not fully passed.');
  if (intake.needs_visual_acceptance && gates?.gates?.visual_evidence?.status !== 'passed') problems.push('Visual acceptance is pending.');
  if (gates?.gates?.fake_data?.status === 'failed') problems.push('Fake data scanner failed.');

  const recommended = problems.length ? 'Do not close. Fix or explicitly resolve blockers.' : 'Can proceed to evidence/close if user approval requirements are satisfied.';
  const md = `# Self Review — ${requestId}\n\n` +
    `## Technical\n\n${validation ? `Validation status: ${validation.status}` : 'Validation not run.'}\n\n` +
    `## Product\n\n${acceptance ? acceptance.summary : 'Acceptance not evaluated.'}\n\n` +
    `## Problems Found\n\n${bullet(problems)}\n\n` +
    `## Recommended Action\n\n${recommended}\n`;

  writeText(paths.selfReview, md);
  writeText(paths.codeReview, `# Code Review — ${requestId}\n\nAutomated code review placeholder. Use executor logs, validation and diff for deeper review.\n`);
  writeText(paths.productReview, `# Product Review — ${requestId}\n\nAcceptance summary: ${acceptance ? acceptance.summary : 'not evaluated'}\n`);
  return { request_id: requestId, problems, recommended_action: recommended };
}
