import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTempProject, cleanup } from './helpers.js';
import { loadConfig } from '../src/core/state.js';
import { buildExecutorEnv, executorAuthStatus } from '../src/engines/executor-auth.js';
import { checkBudgetBeforeCall, recordUsage, readUsageSummary } from '../src/engines/usage-budget.js';

test('executor chatgpt auth strips API keys from child executor env', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const parentEnv = { OPENAI_API_KEY: 'sk-test', OPENAI_PROJECT_ID: 'proj', PATH: '/bin' };
    const built = buildExecutorEnv(config, parentEnv);
    assert.equal(built.policy.mode, 'chatgpt');
    assert.equal(built.env.OPENAI_API_KEY, undefined);
    assert.equal(built.env.OPENAI_PROJECT_ID, undefined);
    assert.equal(built.env.PATH, '/bin');
    assert.deepEqual(built.removed.sort(), ['OPENAI_API_KEY', 'OPENAI_PROJECT_ID']);
    const status = executorAuthStatus(config, parentEnv);
    assert.equal(status.safe_for_chatgpt_plan_execution, true);
    assert.deepEqual(status.api_env_will_be_removed_for_executor.sort(), ['OPENAI_API_KEY', 'OPENAI_PROJECT_ID']);
  } finally { cleanup(root); }
});

test('usage budget records calls and blocks projected spend over hard limit', () => {
  const root = makeTempProject();
  try {
    const config = { ...loadConfig(root), usage_budget: { enabled: true, monthly_budget_usd: 1, hard_stop_at_ratio: 1, warn_at_ratio: 0.8, fallback_when_exceeded: true } };
    recordUsage(root, { kind: 'ai_intake', request_id: 'REQ-001', provider: 'openai', model: 'gpt-5.4', input_tokens: 1000, output_tokens: 1000, estimated_cost_usd: 0.2 });
    const summary = readUsageSummary(root);
    assert.equal(summary.calls, 1);
    assert.equal(summary.estimated_cost_usd, 0.2);
    assert.equal(checkBudgetBeforeCall(root, config, 0.5).allowed, true);
    const blocked = checkBudgetBeforeCall(root, config, 0.9);
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /exceeds hard budget/);
  } finally { cleanup(root); }
});
