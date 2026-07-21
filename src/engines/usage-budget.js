import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { ensureDir, readJsonSafe, writeJson } from '../core/fs.js';
import { nowIso } from '../core/format.js';

const DEFAULT_PRICES_USD_PER_1M = {
  'gpt-5.5': { input: 5.0, output: 30.0 },
  'gpt-5.4': { input: 2.5, output: 15.0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 }
};

export function estimateTokensFromChars(text) {
  return Math.ceil(String(text || '').length / 4);
}

export function pricingForModel(config = {}, model = '') {
  const configured = config.ai_intake?.pricing_usd_per_1m || {};
  return configured[model] || DEFAULT_PRICES_USD_PER_1M[model] || { input: 2.0, output: 8.0 };
}

export function estimateAiCostUsd(config = {}, model, inputTokens, outputTokens) {
  const price = pricingForModel(config, model);
  return ((inputTokens || 0) * price.input + (outputTokens || 0) * price.output) / 1_000_000;
}

export function currentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function usageLedgerPath(root) {
  return aiPath(root, 'usage', 'usage.ndjson');
}

export function readUsageSummary(root, month = currentMonthKey()) {
  const file = usageLedgerPath(root);
  const summary = { month, calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, by_kind: {} };
  if (!fs.existsSync(file)) return summary;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.month !== month) continue;
      summary.calls += 1;
      summary.input_tokens += Number(item.input_tokens || 0);
      summary.output_tokens += Number(item.output_tokens || 0);
      summary.estimated_cost_usd += Number(item.estimated_cost_usd || 0);
      const kind = item.kind || 'unknown';
      summary.by_kind[kind] ||= { calls: 0, estimated_cost_usd: 0 };
      summary.by_kind[kind].calls += 1;
      summary.by_kind[kind].estimated_cost_usd += Number(item.estimated_cost_usd || 0);
    } catch { /* ignore broken lines */ }
  }
  summary.estimated_cost_usd = Number(summary.estimated_cost_usd.toFixed(6));
  return summary;
}

export function recordUsage(root, entry) {
  const file = usageLedgerPath(root);
  ensureDir(path.dirname(file));
  const normalized = {
    timestamp: nowIso(),
    month: currentMonthKey(),
    ...entry,
    estimated_cost_usd: Number((entry.estimated_cost_usd || 0).toFixed(6))
  };
  fs.appendFileSync(file, JSON.stringify(normalized) + '\n');
  writeJson(aiPath(root, 'usage', 'summary.json'), readUsageSummary(root));
  return normalized;
}

export function budgetConfig(config = {}) {
  const env = process.env;
  return {
    enabled: env.ACF_AI_BUDGET_ENABLED ? env.ACF_AI_BUDGET_ENABLED !== 'false' : config.usage_budget?.enabled !== false,
    monthly_budget_usd: Number(env.ACF_AI_MONTHLY_BUDGET_USD || config.usage_budget?.monthly_budget_usd || 10),
    warn_at_ratio: Number(env.ACF_AI_BUDGET_WARN_RATIO || config.usage_budget?.warn_at_ratio || 0.8),
    hard_stop_at_ratio: Number(env.ACF_AI_BUDGET_HARD_STOP_RATIO || config.usage_budget?.hard_stop_at_ratio || 1.0),
    fallback_when_exceeded: env.ACF_AI_BUDGET_FALLBACK_WHEN_EXCEEDED ? env.ACF_AI_BUDGET_FALLBACK_WHEN_EXCEEDED !== 'false' : config.usage_budget?.fallback_when_exceeded !== false,
    // v5.0 per-REQ circuit breaker. Retry loops compound at inflated context
    // size; the granularity that protects the wallet is the request, not the month.
    per_req_hard_usd: Number(env.ACF_AI_PER_REQ_HARD_USD || config.usage_budget?.per_req_hard_usd || 5),
    max_brain_calls_per_req: Number(env.ACF_AI_MAX_BRAIN_CALLS_PER_REQ || config.usage_budget?.max_brain_calls_per_req || 15)
  };
}

// Aggregated ledger view for a single request across all months.
export function reqUsageSummary(root, requestId) {
  const summary = { request_id: requestId, calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, by_kind: {} };
  const file = usageLedgerPath(root);
  if (!fs.existsSync(file)) return summary;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let item = null;
    try { item = JSON.parse(line); } catch { continue; }
    if (!item || item.request_id !== requestId) continue;
    summary.calls += 1;
    summary.input_tokens += Number(item.input_tokens || 0);
    summary.output_tokens += Number(item.output_tokens || 0);
    summary.estimated_cost_usd += Number(item.estimated_cost_usd || 0);
    const kind = item.kind || 'unknown';
    summary.by_kind[kind] ||= { calls: 0, estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0 };
    summary.by_kind[kind].calls += 1;
    summary.by_kind[kind].estimated_cost_usd += Number(item.estimated_cost_usd || 0);
    summary.by_kind[kind].input_tokens += Number(item.input_tokens || 0);
    summary.by_kind[kind].output_tokens += Number(item.output_tokens || 0);
  }
  summary.estimated_cost_usd = Number(summary.estimated_cost_usd.toFixed(6));
  return summary;
}

export function checkReqBudgetBeforeCall(root, config = {}, requestId, projectedCostUsd = 0) {
  const budget = budgetConfig(config);
  if (!budget.enabled || !requestId) return { allowed: true, reason: 'Per-REQ guard disabled or no request id.' };
  const summary = reqUsageSummary(root, requestId);
  if (summary.calls >= budget.max_brain_calls_per_req) {
    return { allowed: false, summary, reason: `Circuit breaker: ${summary.calls} brain calls already made for ${requestId} (limit ${budget.max_brain_calls_per_req}). A loop is probably burning tokens; review the trace before continuing.` };
  }
  const projected = summary.estimated_cost_usd + Number(projectedCostUsd || 0);
  if (projected > budget.per_req_hard_usd) {
    return { allowed: false, summary, reason: `Per-REQ budget: projected $${projected.toFixed(4)} exceeds hard limit $${budget.per_req_hard_usd.toFixed(2)} for ${requestId}.` };
  }
  return { allowed: true, summary, projected_cost_usd: Number(projected.toFixed(6)) };
}

export function checkBudgetBeforeCall(root, config = {}, projectedCostUsd = 0) {
  const budget = budgetConfig(config);
  const summary = readUsageSummary(root);
  const projected = summary.estimated_cost_usd + Number(projectedCostUsd || 0);
  if (!budget.enabled) return { allowed: true, budget, summary, projected_cost_usd: projected, reason: 'Budget guard disabled.' };
  const hardLimit = budget.monthly_budget_usd * budget.hard_stop_at_ratio;
  const warnLimit = budget.monthly_budget_usd * budget.warn_at_ratio;
  if (projected > hardLimit) {
    return { allowed: false, budget, summary, projected_cost_usd: Number(projected.toFixed(6)), reason: `Projected AI usage $${projected.toFixed(4)} exceeds hard budget $${hardLimit.toFixed(2)}.` };
  }
  return { allowed: true, budget, summary, projected_cost_usd: Number(projected.toFixed(6)), warning: projected > warnLimit ? `Projected AI usage exceeds warning threshold $${warnLimit.toFixed(2)}.` : null };
}
