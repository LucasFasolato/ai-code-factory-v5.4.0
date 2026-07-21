import { exists, readJsonSafe, writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';

export function runQualityReview(root, requestId) {
  const paths = requestPaths(root, requestId);
  const gates = exists(paths.gates) ? readJsonSafe(paths.gates, null) : null;
  const acceptance = exists(paths.acceptance) ? readJsonSafe(paths.acceptance, null) : null;
  const validation = exists(paths.validation) ? readJsonSafe(paths.validation, null) : null;
  const execution = exists(paths.executionStatus) ? readJsonSafe(paths.executionStatus, null) : null;
  const intake = exists(paths.intake) ? readJsonSafe(paths.intake, null) : null;
  let score = 100;
  const hardBlockers = [];
  const productRisks = [];
  const recommendations = [];

  if (!execution || execution.status !== 'success') { score -= 25; hardBlockers.push(`Executor did not complete successfully${execution ? ` (${execution.status})` : ''}.`); }
  if (!validation || validation.status !== 'passed') { score -= 20; hardBlockers.push('Technical validation not passed.'); }
  if (!acceptance || !acceptance.close_allowed) { score -= 15; productRisks.push('Acceptance criteria not fully passed.'); }
  if (!gates?.close_allowed) { score -= 20; hardBlockers.push('Close gate is blocked.'); }
  if (intake?.requires_decomposition || intake?.work_type === 'product_epic') { score -= 10; productRisks.push('Request is an epic; quality depends on roadmap and child REQs, not direct implementation.'); }
  for (const [name, gate] of Object.entries(gates?.gates || {})) {
    if (gate.status === 'failed') { score -= 10; hardBlockers.push(`${name}: ${gate.reason}`); }
    if (gate.status === 'pending') { score -= 5; productRisks.push(`${name}: ${gate.reason}`); }
    if (gate.status === 'warning') productRisks.push(`${name}: ${gate.reason}`);
  }
  if (execution?.files_touched?.length) recommendations.push(`Review ${execution.files_touched.length} touched file(s) against the contract.`);
  if (gates?.gates?.scope?.status === 'failed') recommendations.push('Revert or explicitly approve out-of-scope files before continuing.');
  if (!recommendations.length) recommendations.push(score >= 85 ? 'Can proceed if human approvals are satisfied.' : 'Resolve blockers before closing.');
  score = Math.max(0, score);
  const md = `# Quality Review — ${requestId}\n\nScore: ${(score / 10).toFixed(1)}/10\n\n` +
    `## Hard blockers\n\n${hardBlockers.length ? hardBlockers.map((p) => `- ${p}`).join('\n') : '- None detected.'}\n\n` +
    `## Product / process risks\n\n${productRisks.length ? productRisks.map((p) => `- ${p}`).join('\n') : '- None detected.'}\n\n` +
    `## Recommendation\n\n${recommendations.map((p) => `- ${p}`).join('\n')}\n`;
  const file = `${paths.productReview.replace('-product-review.md', '-quality-review.md')}`;
  writeText(file, md);
  return { request_id: requestId, score, problems: [...hardBlockers, ...productRisks], markdown: md };
}
