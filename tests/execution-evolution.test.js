import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { buildExecutorCommand } from '../src/engines/executor-orchestrator.js';
import { safeToAutoFix } from '../src/engines/auto-iteration-engine.js';
import { generateEvidencePack } from '../src/engines/evidence-pack-engine.js';
import { playbookUpgrade } from '../src/engines/playbook-evolution.js';
import { distillSkill } from '../src/engines/skill-pattern-engine.js';
import { calibrateAutonomy } from '../src/engines/autonomy-calibration.js';
import { appendEvent } from '../src/core/events.js';
import { saveExecutionContract } from '../src/engines/execution-contract-engine.js';
import { lockConstraint } from '../src/engines/constraint-engine.js';
import { evaluateGates } from '../src/engines/gate-engine.js';
import { loadConfig } from '../src/core/state.js';
import { aiPath, requestPaths } from '../src/core/paths.js';
import { writeJson, readText } from '../src/core/fs.js';

test('codex command builder uses exec + args array (KF-005 regression)', () => {
  const config = loadConfig(makeTempProject());
  const command = buildExecutorCommand('codex', config, '/tmp/project', 'do the thing');
  assert.equal(command.command, 'codex');
  assert.equal(command.args[0], 'exec');
  assert.ok(command.args.includes('--sandbox'));
  assert.ok(command.args.includes('-C'));
  assert.equal(command.args[command.args.length - 1], 'do the thing');
  assert.equal(command.shell, false);
});

test('auto-iteration refuses to touch human-only blockers', () => {
  assert.equal(safeToAutoFix({ close_blockers: ['fake_data: phone detected'] }).can_fix, false);
  assert.equal(safeToAutoFix({ close_blockers: ['approved_design: missing'] }).can_fix, false);
  assert.equal(safeToAutoFix({ close_blockers: ['locked_constraints: violated'] }).can_fix, false);
  assert.equal(safeToAutoFix({ close_blockers: ['technical_validation: lint failed'] }).can_fix, true);
});

test('execution contract injects locked constraints', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    lockConstraint(root, 'Never remove the pagination component');
    const { requestId } = createRequest(root, 'Crear endpoint API propiedades', config);
    const contract = saveExecutionContract(root, requestId);
    assert.ok(contract.markdown.includes('Locked Constraints'));
    assert.ok(contract.markdown.includes('Never remove the pagination component'));
  } finally { cleanup(root); }
});

test('evidence pack reflects gates, execution and files touched', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Crear endpoint API propiedades', config);
    writeJson(requestPaths(root, requestId).executionStatus, {
      request_id: requestId, executor: 'codex', status: 'success', reason: 'Executor completed.',
      timed_out: false, files_touched: ['src/properties/controller.ts']
    });
    evaluateGates(root, requestId, config);
    const evidence = generateEvidencePack(root, requestId);
    assert.ok(evidence.markdown.includes('Files touched'));
    assert.ok(evidence.markdown.includes('src/properties/controller.ts'));
    assert.ok(fs.existsSync(requestPaths(root, requestId).evidence));
  } finally { cleanup(root); }
});

test('playbook-upgrade proposes but does not apply without --apply', () => {
  const root = makeTempProject();
  try {
    // Two repeated visual failures
    writeJson(aiPath(root, 'history', 'failures', 'REQ-001-failure-classification.json'), { classes: [{ class: 'visual', reason: 'x' }] });
    writeJson(aiPath(root, 'history', 'failures', 'REQ-002-failure-classification.json'), { classes: [{ class: 'visual', reason: 'y' }] });
    const before = readText(aiPath(root, 'playbooks', 'frontend-visual.md'));
    const proposed = playbookUpgrade(root, { apply: false });
    assert.equal(proposed.applied, false);
    assert.equal(readText(aiPath(root, 'playbooks', 'frontend-visual.md')), before, 'playbook must not change without apply');
    assert.ok(fs.existsSync(proposed.proposal_file));

    const applied = playbookUpgrade(root, { apply: true });
    assert.equal(applied.applied, true);
    const after = readText(aiPath(root, 'playbooks', 'frontend-visual.md'));
    assert.ok(after.includes('Learned rules'));
    // Previous version snapshotted
    const versions = fs.readdirSync(aiPath(root, 'playbooks', 'versions'));
    assert.ok(versions.some((v) => v.startsWith('frontend-visual-')));
  } finally { cleanup(root); }
});

test('distill-skill writes a reusable skill from a request', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing premium inmobiliaria', config);
    evaluateGates(root, requestId, config);
    const result = distillSkill(root, requestId);
    assert.ok(fs.existsSync(result.path));
    assert.ok(result.markdown.includes('Proven flow'));
    assert.ok(result.markdown.includes('design approve (explicit option, never fallback)'));
  } finally { cleanup(root); }
});

test('calibrate-autonomy needs data, then recommends based on success rate', () => {
  const root = makeTempProject();
  try {
    const first = calibrateAutonomy(root);
    assert.equal(first.status, 'insufficient_data');
    // 4 requests with successful executions
    for (let i = 1; i <= 4; i++) {
      const id = `REQ-00${i}`;
      appendEvent(root, 'ASK_CREATED', { request_id: id, ask: 'x' });
      appendEvent(root, 'EXECUTION_FINISHED', { request_id: id, status: 'success' });
    }
    const second = calibrateAutonomy(root);
    assert.equal(second.status, 'ok');
    assert.ok(second.recommended_level >= second.current_level);
    assert.equal(second.applied, false); // never applies without --apply
  } finally { cleanup(root); }
});
