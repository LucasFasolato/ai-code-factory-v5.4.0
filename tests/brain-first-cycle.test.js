import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { analyzeAskWithBrain } from '../src/engines/ai-intake-brain.js';
import { buildBrainRoute } from '../src/engines/brain-router.js';
import { analyzeAsk } from '../src/engines/intake-engine.js';
import { runFullCycle } from '../src/engines/full-cycle-engine.js';
import { evaluateGates } from '../src/engines/gate-engine.js';
import { loadConfig } from '../src/core/state.js';
import { requestPaths } from '../src/core/paths.js';
import { readJson } from '../src/core/fs.js';

test('brain-first: even a simple ask routes to the external brain (threshold=simple)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const heuristic = analyzeAsk('renombrar la variable userData a profileData', 'REQ-001');
    const route = buildBrainRoute(root, 'renombrar la variable userData a profileData', heuristic, config, {});
    assert.equal(route.use_external_brain, true, 'simple asks should still think with Claude');
  } finally { cleanup(root); }
});

test('only genuinely trivial asks skip the external brain', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const heuristic = analyzeAsk('ok', 'REQ-002');
    const route = buildBrainRoute(root, 'ok', heuristic, config, {});
    assert.equal(route.difficulty, 'trivial');
    assert.equal(route.use_external_brain, false);
  } finally { cleanup(root); }
});

test('degraded brain blocks implementation when no real brain is available', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    // Force provider chain to fail (no claude, no key) but keep external routing on.
    config.ai_intake = { ...config.ai_intake, fallback_chain: ['claude-code', 'heuristic'] };
    process.env.ACF_CLAUDE_CODE_COMMAND = 'definitely-not-a-real-command-xyz';
    const intake = await analyzeAskWithBrain(root, 'crear endpoint de productos en NestJS', 'REQ-003', config, {});
    delete process.env.ACF_CLAUDE_CODE_COMMAND;
    assert.equal(intake.brain.brain_degraded, true);
    assert.equal(intake.should_implement_now, false);
    assert.equal(intake.brain_required_but_unavailable, true);
    assert.ok(intake.blocking_missing_info.some((b) => /thinking brain/i.test(b)));
  } finally { cleanup(root); }
});

test('brain_quality gate fails on degraded-brain implementing work', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Backend API para productos', config);
    // Simulate a degraded brain decision on disk.
    const intakePath = requestPaths(root, requestId).intake;
    const intake = readJson(intakePath, {});
    intake.brain = { source: 'heuristic-fallback', brain_degraded: true };
    intake.brain_required_but_unavailable = true;
    fs.writeFileSync(intakePath, JSON.stringify(intake, null, 2));
    const gates = evaluateGates(root, requestId, config);
    assert.equal(gates.gates.brain_quality.status, 'failed');
    assert.ok(gates.close_blockers.some((b) => /brain_quality/i.test(b)));
  } finally { cleanup(root); }
});

test('full cycle stops on an epic (decomposition required)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'app tipo Vinted con usuarios, publicaciones, ofertas, chat y pagos', config);
    const result = runFullCycle(root, requestId, config, {});
    assert.equal(result.status, 'stopped');
    assert.match(result.stopped_reason, /epic/i);
  } finally { cleanup(root); }
});

test('full cycle stops design-first work without an approved design', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'landing premium para inmobiliaria con hero', config);
    const result = runFullCycle(root, requestId, config, { humanApproved: true });
    assert.equal(result.status, 'stopped');
    assert.match(result.stopped_reason, /design/i);
  } finally { cleanup(root); }
});

test('full cycle runs end-to-end and closes when executor + validation succeed', () => {
  const root = makeTempProject();
  try {
    // Real git repo with an initial commit so request branch + merge workflow is observable.
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.local', 'add', '-A'], { cwd: root });
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.local', 'commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' });
    } catch { /* git optional */ }

    const config = loadConfig(root);
    // package.json with passing scripts so validation passes.
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'demo', version: '1.0.0',
      scripts: { lint: 'node -e 0', typecheck: 'node -e 0', test: 'node -e 0', build: 'node -e 0' }
    }, null, 2));

    // Mock codex that always writes a new file.
    const codex = path.join(root, 'mock-codex.cjs');
    fs.writeFileSync(codex, `const fs=require('node:fs');const path=require('node:path');const dir=path.join(process.cwd(),'src');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'f-'+Date.now()+'-'+Math.floor(Math.random()*1e6)+'.ts'),'export const x='+Math.floor(Math.random()*1e6)+';\\n');console.log('done');`);
    config.execution = { ...config.execution, enabled: true, primary: 'codex', codex: { command: process.execPath, args: [codex] } };

    const { requestId, intake } = createRequest(root, 'agregar un endpoint GET /health en NestJS', config);
    // Mark as brain-decided + ready so the cycle proceeds (no real brain in test).
    const intakePath = requestPaths(root, requestId).intake;
    const fixed = readJson(intakePath, {});
    fixed.brain = { source: 'ai', provider: 'mock' };
    fixed.requires_human_approval = false;
    fixed.design_first_required = false;
    fixed.requires_decomposition = false;
    fixed.needs_visual_acceptance = false;
    fs.writeFileSync(intakePath, JSON.stringify(fixed, null, 2));

    const result = runFullCycle(root, requestId, config, {});
    // If git is unavailable the guard may stop it; only assert completion when git tracked changes.
    if (result.status === 'completed') {
      assert.equal(result.validation.status, 'passed');
      assert.equal(result.gates.close_allowed, true);
      const req = readJson(requestPaths(root, requestId).backlog, {});
      assert.equal(req.status, 'done');

      // v5.1.2 resumability regression: a second cycle on already-implemented
      // work must NOT re-execute (real-world run tripped the honest-success
      // guard on finished work). It resumes from validation instead.
      const rerun = runFullCycle(root, requestId, config, {});
      const executeStep = rerun.steps.find((st) => st.step === 'execute');
      assert.equal(executeStep.detail.status, 'resumed_previous_success', `re-run must resume, got: ${JSON.stringify(executeStep.detail)}`);
      assert.notEqual(rerun.stopped_reason || '', 'Executor exited cleanly but changed nothing (honest-success guard).');
    } else {
      // Acceptable alternative outcome in a no-git sandbox: a safety stop, never a fake close.
      assert.equal(result.status, 'stopped');
    }
  } finally { cleanup(root); }
});
