import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readNdjson } from '../core/fs.js';
import { readUsageSummary, budgetConfig } from './usage-budget.js';

// v5.2 Stats — observability treated as queryable data instead of console
// exhaust. Aggregates the NDJSON event log, gate results and the usage ledger
// into the questions that actually matter: what blocks REQs, where tokens go,
// and how the factory is trending.

export function buildStats(root, config = {}) {
  const events = safeEvents(root);
  const gates = collectGateResults(root);
  const usage = readUsageSummary(root);
  const budget = budgetConfig(config);

  const byType = {};
  for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;

  const reqsCreated = byType.ASK_CREATED || 0;
  const reqsClosed = (byType.REQ_CLOSED || 0) + (byType.CYCLE_COMPLETED || 0);

  const blockerCounts = {};
  for (const g of gates) {
    for (const blocker of g.close_blockers || []) {
      const key = String(blocker).split(':')[0].trim();
      blockerCounts[key] = (blockerCounts[key] || 0) + 1;
    }
  }

  return {
    requests: { created: reqsCreated, closed: reqsClosed, completion_rate: reqsCreated ? Number((reqsClosed / reqsCreated).toFixed(2)) : null },
    top_blockers: Object.entries(blockerCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([gate, count]) => ({ gate, count })),
    events_by_type: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, count]) => ({ type, count })),
    usage: {
      month: usage.month,
      calls: usage.calls,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      estimated_cost_usd: usage.estimated_cost_usd,
      monthly_budget_usd: budget.monthly_hard_usd,
      by_kind: usage.by_kind || {}
    }
  };
}

export function renderStats(stats) {
  const lines = ['# AI Code Factory — Stats', ''];
  lines.push(`REQs: ${stats.requests.created} created · ${stats.requests.closed} closed${stats.requests.completion_rate !== null ? ` · ${Math.round(stats.requests.completion_rate * 100)}% completion` : ''}`);
  lines.push('');
  lines.push('## What blocks closes (top gates)');
  if (!stats.top_blockers.length) lines.push('- No blockers recorded yet.');
  for (const b of stats.top_blockers) lines.push(`- ${b.gate}: ${b.count}x`);
  lines.push('');
  lines.push(`## Token usage (${stats.usage.month || 'current month'})`);
  lines.push(`Brain calls: ${stats.usage.calls} · ${stats.usage.input_tokens} in / ${stats.usage.output_tokens} out · $${Number(stats.usage.estimated_cost_usd || 0).toFixed(4)} of $${Number(stats.usage.monthly_budget_usd || 0).toFixed(2)}`);
  const kinds = Object.entries(stats.usage.by_kind).sort((a, b) => (b[1].estimated_cost_usd || 0) - (a[1].estimated_cost_usd || 0)).slice(0, 5);
  for (const [kind, data] of kinds) lines.push(`- ${kind}: ${data.calls} call(s), $${Number(data.estimated_cost_usd || 0).toFixed(4)}`);
  lines.push('');
  lines.push('## Activity (top events)');
  for (const e of stats.events_by_type) lines.push(`- ${e.type}: ${e.count}`);
  return lines.join('\n');
}

function safeEvents(root) {
  try { return readNdjson(aiPath(root, 'events', 'events.ndjson')); } catch { return []; }
}

function collectGateResults(root) {
  const dir = aiPath(root, 'reasoning', 'gates');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('deterministic'))) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))); } catch { /* skip */ }
  }
  return out;
}
