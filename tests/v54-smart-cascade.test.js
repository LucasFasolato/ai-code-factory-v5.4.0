import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup } from './helpers.js';
import { escalateDepth, escalationConfig, modelForDepth } from '../src/engines/brain-router.js';
import { reasoningEffortFor, buildExecutorCommand } from '../src/engines/executor-orchestrator.js';
import { analyzeAskWithBrain } from '../src/engines/ai-intake-brain.js';
import { reqUsageSummary } from '../src/engines/usage-budget.js';

// v5.4 — the thinking orchestrator picks models and effort with senior criteria.

test('depth ladder escalates one honest step and stops at the top', () => {
  assert.equal(escalateDepth('fast'), 'standard');
  assert.equal(escalateDepth('standard'), 'deep');
  assert.equal(escalateDepth('deep'), 'architect');
  assert.equal(escalateDepth('architect'), null);
});

test('reasoning effort policy: trivial work thinks light, risky work thinks hard', () => {
  assert.equal(reasoningEffortFor({ risk: 'low', difficulty: 'trivial' }), 'low');
  assert.equal(reasoningEffortFor({ risk: 'low', difficulty: 'simple' }), 'low');
  assert.equal(reasoningEffortFor({ risk: 'medium', difficulty: 'medium' }), 'medium');
  assert.equal(reasoningEffortFor({ risk: 'high', difficulty: 'simple' }), 'high');
  assert.equal(reasoningEffortFor({ risk: 'low', difficulty: 'complex' }), 'high');
  assert.equal(reasoningEffortFor({}), 'medium');
});

test('codex command carries orchestrator-decided reasoning effort; user pins and opt-out win', () => {
  const base = { execution: { codex: { command: 'codex', args: ['exec', '--skip-git-repo-check', '-C'] } } };
  const built = buildExecutorCommand('codex', base, '/repo', 'do it', { reasoningEffort: 'low' });
  assert.ok(built.args.includes('model_reasoning_effort="low"'), `effort must ride into args: ${built.args.join(' ')}`);
  assert.ok(built.args.indexOf('--config') < built.args.indexOf('-C'), 'flags must precede -C');

  // User pinned it → orchestrator never overrides an explicit human choice.
  const pinned = { execution: { codex: { command: 'codex', args: ['exec', '--config', 'model_reasoning_effort="xhigh"', '-C'] } } };
  const builtPinned = buildExecutorCommand('codex', pinned, '/repo', 'do it', { reasoningEffort: 'low' });
  assert.equal(builtPinned.args.filter((a) => String(a).includes('model_reasoning_effort')).length, 1);
  assert.ok(builtPinned.args.includes('model_reasoning_effort="xhigh"'));

  // Global opt-out.
  const off = { execution: { adaptive_reasoning: false, codex: { command: 'codex', args: ['exec', '-C'] } } };
  const builtOff = buildExecutorCommand('codex', off, '/repo', 'do it', { reasoningEffort: 'high' });
  assert.ok(!builtOff.args.some((a) => String(a).includes('model_reasoning_effort')));
});

test('cascade escalates on low confidence: cheap answers, senior double-checks, usage records both', async () => {
  const root = makeTempProject();
  const stateFile = path.join(root, 'calls.txt');
  const mock = path.join(root, 'mock-claude.cjs');
  const decision = (confidence) => JSON.stringify({ intent: 'add health endpoint', work_type: 'backend_api', difficulty: 'medium', scope: 'single_feature', risk: 'medium', recommended_workflow: 'contract-first', should_implement_now: true, confidence });
  fs.writeFileSync(mock, `
const fs = require('node:fs');
try { fs.readFileSync(0, 'utf8'); } catch {}
let n = 0; try { n = Number(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8')); } catch {}
fs.writeFileSync(${JSON.stringify(stateFile)}, String(n + 1));
console.log(n === 0 ? ${JSON.stringify(decision(0.6))} : ${JSON.stringify(decision(0.92))});
`, 'utf8');
  try {
    const config = {
      ai_intake: {
        provider: 'claude-code',
        fallback_chain: ['claude-code', 'heuristic'],
        claude_code: { command: process.execPath, args: [mock], prompt_mode: 'stdin', output_format: 'text' }
      },
      brain_routing: { escalation: { enabled: true, min_confidence: 0.75 } }
    };
    const intake = await analyzeAskWithBrain(root, 'agregar endpoint de salud para monitoreo', 'REQ-050', config, { depth: 'standard' });
    assert.equal(intake.brain.source, 'ai');
    assert.equal(intake.confidence, 0.92, 'the senior answer must win');
    assert.ok(intake.brain.escalation, 'escalation must be recorded');
    assert.equal(intake.brain.escalation.from, 'standard');
    assert.equal(intake.brain.escalation.to, 'deep');
    assert.match(intake.brain.escalation.reason, /confidence 0\.6/);
    const usage = reqUsageSummary(root, 'REQ-050');
    assert.equal(usage.calls, 2, 'both attempts count against the per-REQ budget');
  } finally { cleanup(root); }
});

test('cascade does NOT escalate when the cheap tier is confident (cost discipline)', async () => {
  const root = makeTempProject();
  const mock = path.join(root, 'mock-claude.cjs');
  fs.writeFileSync(mock, `
try { require('node:fs').readFileSync(0, 'utf8'); } catch {}
console.log(JSON.stringify({ intent: 'x', work_type: 'small_change', difficulty: 'simple', risk: 'low', recommended_workflow: 'direct-patch-with-validation', should_implement_now: true, confidence: 0.9 }));
`, 'utf8');
  try {
    const config = { ai_intake: { provider: 'claude-code', fallback_chain: ['claude-code', 'heuristic'], claude_code: { command: process.execPath, args: [mock], prompt_mode: 'stdin', output_format: 'text' } } };
    const intake = await analyzeAskWithBrain(root, 'agregar validacion de email al formulario de registro', 'REQ-051', config, { depth: 'standard' });
    assert.equal(intake.brain.source, 'ai', 'the brain must actually run for this test to mean anything');
    assert.equal(intake.brain.escalation ?? null, null, 'confident cheap answers must not pay for a second opinion');
    assert.equal(reqUsageSummary(root, 'REQ-051').calls, 1);
  } finally { cleanup(root); }
});

test('escalation config defaults are sane and overridable', () => {
  const d = escalationConfig({});
  assert.equal(d.enabled, true);
  assert.equal(d.min_confidence, 0.75);
  assert.equal(escalationConfig({ brain_routing: { escalation: { enabled: false } } }).enabled, false);
  assert.equal(escalationConfig({ brain_routing: { escalation: { min_confidence: 0.9 } } }).min_confidence, 0.9);
});
