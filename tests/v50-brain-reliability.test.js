import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup } from './helpers.js';
import { unwrapClaudeEnvelope, parseProviderJson } from '../src/core/json-utils.js';
import { runIntakeProvider } from '../src/engines/ai-intake-provider.js';

const VALID_DECISION = JSON.stringify({ intent: 'x', work_type: 'small_change', confidence: 0.9 });

test('unwrapClaudeEnvelope extracts result from --output-format json envelope', () => {
  const envelope = JSON.stringify({ type: 'result', is_error: false, result: `Claro, acá está:\n\`\`\`json\n${VALID_DECISION}\n\`\`\``, usage: { input_tokens: 100, output_tokens: 50 }, total_cost_usd: 0.01 });
  const unwrapped = unwrapClaudeEnvelope(envelope);
  assert.equal(unwrapped.unwrapped, true);
  assert.equal(unwrapped.envelope.usage.input_tokens, 100);
  const parsed = parseProviderJson(unwrapped.text);
  assert.equal(parsed.parsed.work_type, 'small_change');
});

test('unwrapClaudeEnvelope passes through plain model output untouched', () => {
  const unwrapped = unwrapClaudeEnvelope(`Some preamble\n${VALID_DECISION}`);
  assert.equal(unwrapped.unwrapped, false);
  const parsed = parseProviderJson(unwrapped.text);
  assert.equal(parsed.parsed.confidence, 0.9);
});

test('unwrapClaudeEnvelope surfaces envelope-level errors instead of parsing garbage', () => {
  const envelope = JSON.stringify({ type: 'result', is_error: true, result: 'Invalid API key' });
  assert.throws(() => unwrapClaudeEnvelope(envelope), /envelope reported an error/i);
});

test('strict retry recovers when the first reply is prose and the second is JSON', async () => {
  const root = makeTempProject();
  const stateFile = path.join(root, 'attempts.txt');
  const mock = path.join(root, 'mock-claude.cjs');
  // First call: prose without JSON. Second call (strict retry): valid JSON.
  fs.writeFileSync(mock, `
const fs = require('node:fs');
fs.readFileSync(0, 'utf8');
let n = 0;
try { n = Number(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8')); } catch {}
fs.writeFileSync(${JSON.stringify(stateFile)}, String(n + 1));
if (n === 0) console.log('I would classify this as a small change, happy to help!');
else console.log(${JSON.stringify(VALID_DECISION)});
`, 'utf8');
  try {
    const config = {
      ai_intake: {
        provider: 'claude-code',
        fallback_chain: ['claude-code', 'heuristic'],
        claude_code: { command: process.execPath, args: [mock], prompt_mode: 'arg', arg_prompt_max_chars: 8000, output_format: 'text' }
      }
    };
    const traceDir = path.join(root, 'raw-traces');
    const result = await runIntakeProvider('classify this ask', config, { traceDir });
    assert.equal(result.parsed.work_type, 'small_change');
    assert.equal(result.repair_used, true, 'strict retry should be flagged as repair');
    assert.ok(result.attempts.some((a) => a.phase === 'strict-retry'), 'a strict-retry attempt must exist');
    const traces = fs.readdirSync(traceDir);
    assert.ok(traces.some((f) => f.includes('initial') && f.endsWith('.stdout.txt')), 'raw stdout of failed attempt persisted');
    assert.ok(traces.some((f) => f.includes('strict-retry')), 'raw stdout of retry persisted');
  } finally { cleanup(root); }
});

test('per-transport failures still fall through without strict retry when process fails', async () => {
  const root = makeTempProject();
  try {
    const config = {
      ai_intake: {
        provider: 'claude-code',
        fallback_chain: ['claude-code', 'heuristic'],
        claude_code: { command: 'definitely-not-a-real-command-v5', args: [], prompt_mode: 'stdin' }
      }
    };
    await assert.rejects(() => runIntakeProvider('anything', config, {}), /Brain providers failed|failed/i);
  } finally { cleanup(root); }
});
