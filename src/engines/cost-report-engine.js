import { aiPath } from '../core/paths.js';
import { ensureDir, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { reqUsageSummary, budgetConfig } from './usage-budget.js';

// v5.0 Cost Report — a monthly total tells you that you spent; a per-REQ,
// per-stage breakdown tells you where the pipeline burns money, which is the
// only view that lets you optimize it.

export function buildCostReport(root, requestId, config = {}) {
  const summary = reqUsageSummary(root, requestId);
  const budget = budgetConfig(config);
  const overBudget = summary.estimated_cost_usd > budget.per_req_hard_usd;
  const lines = [
    `# Cost Report — ${requestId}`,
    '',
    `Generated: ${nowIso()}`,
    '',
    `Brain calls: ${summary.calls}`,
    `Input tokens: ${summary.input_tokens} | Output tokens: ${summary.output_tokens}`,
    `Estimated cost: $${summary.estimated_cost_usd.toFixed(4)} (subscription CLIs report $0; API calls report real cost)`,
    `Per-REQ budget: $${budget.per_req_hard_usd.toFixed(2)} ${overBudget ? '✕ EXCEEDED' : '✔'} | call limit: ${budget.max_brain_calls_per_req} ${summary.calls >= budget.max_brain_calls_per_req ? '✕ REACHED' : '✔'}`,
    '',
    '## By stage'
  ];
  const kinds = Object.entries(summary.by_kind).sort((a, b) => b[1].estimated_cost_usd - a[1].estimated_cost_usd);
  if (!kinds.length) lines.push('- No usage recorded for this REQ yet.');
  for (const [kind, data] of kinds) {
    lines.push(`- ${kind}: ${data.calls} call(s), ${data.input_tokens} in / ${data.output_tokens} out, $${data.estimated_cost_usd.toFixed(4)}`);
  }
  const md = lines.join('\n');
  ensureDir(aiPath(root, 'evidence', 'costs'));
  const file = aiPath(root, 'evidence', 'costs', `${requestId}-cost-report.md`);
  writeText(file, md);
  return { file, summary, markdown: md, over_budget: overBudget };
}
