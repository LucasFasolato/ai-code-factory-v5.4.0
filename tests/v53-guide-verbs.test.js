import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { requestPaths } from '../src/core/paths.js';
import { readJson, writeJson } from '../src/core/fs.js';
import { updateRequest } from '../src/core/state.js';
import { buildGuide, renderGuide } from '../src/engines/guide-engine.js';
import { buildReviewPacket, renderReviewPacket } from '../src/engines/review-engine.js';

// v5.3 — "obvious" means the tool always states the next command.
// These tests pin the guide's answer for each real-world state we hit live.

test('guide: idle project points to start', () => {
  const root = makeTempProject();
  try {
    const g = buildGuide(root, {});
    assert.equal(g.stage, 'idle');
    assert.match(renderGuide(g), /start "tu pedido/);
  } finally { cleanup(root); }
});

test('guide: blocking questions point to answer, then continue', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'agregar cancelacion de reservas');
    const paths = requestPaths(root, requestId);
    const intake = readJson(paths.intake, {});
    intake.blocking_missing_info = ['reglas de devolución'];
    writeJson(paths.intake, intake);
    updateRequest(root, requestId, { status: 'needs_input' });
    const g = buildGuide(root, {});
    assert.equal(g.stage, 'needs_answers');
    const out = renderGuide(g);
    assert.match(out, /reglas de devolución/);
    assert.match(out, new RegExp(`answer ${requestId}`));
  } finally { cleanup(root); }
});

test('guide: executor timeout explains parallel-session throttling and force-execute', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'seccion de contacto');
    const paths = requestPaths(root, requestId);
    writeJson(paths.executionStatus, { status: 'failed', timed_out: true, reason: 'Executor timed out.', log_path: '/x/log.log' });
    const g = buildGuide(root, {});
    assert.equal(g.stage, 'execution_failed');
    const out = renderGuide(g);
    assert.match(out, /continue --force-execute/);
    assert.match(out, /other Codex sessions/i);
    assert.match(g.headline, /log\.log/);
  } finally { cleanup(root); }
});

test('guide: visual pending points to npm run dev + accept', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'seccion visual');
    const paths = requestPaths(root, requestId);
    writeJson(paths.executionStatus, { status: 'success', files_touched: ['src/x.tsx'] });
    writeJson(paths.gates, { close_allowed: false, close_blockers: ['visual_evidence: No approved design or visual acceptance yet.'] });
    const g = buildGuide(root, {});
    assert.equal(g.stage, 'awaiting_visual');
    const out = renderGuide(g);
    assert.match(out, /npm run dev/);
    assert.match(out, /accept/);
  } finally { cleanup(root); }
});

test('guide: done REQ celebrates and points forward', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'listo');
    updateRequest(root, requestId, { status: 'done' });
    const g = buildGuide(root, {});
    assert.equal(g.stage, 'done');
    assert.match(renderGuide(g), /start/);
  } finally { cleanup(root); }
});

test('review packet assembles decision data and renders without crashes on partial state', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'endpoint de reservas');
    const paths = requestPaths(root, requestId);
    writeJson(paths.executionStatus, { status: 'success', files_touched: ['src/r.controller.ts'] });
    writeJson(paths.validation, { status: 'passed' });
    writeJson(paths.gates, { close_allowed: false, close_blockers: ['acceptance_criteria: 1 pending'] });
    const packet = buildReviewPacket(root, requestId, {});
    assert.equal(packet.execution_status, 'success');
    assert.deepEqual(packet.files_touched, ['src/r.controller.ts']);
    const out = renderReviewPacket(packet);
    assert.match(out, /# Review — REQ-/);
    assert.match(out, /Technical validation: ✅ passed/);
    assert.match(out, /acceptance_criteria: 1 pending/);
    assert.match(out, /Cost/);
  } finally { cleanup(root); }
});

test('contract never contradicts itself: override to direct-patch removes stale design constraints', async () => {
  const { buildExecutionContract } = await import('../src/engines/execution-contract-engine.js');
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'seccion de contacto simple en la home');
    const paths = requestPaths(root, requestId);
    const intake = readJson(paths.intake, {});
    // Pre-override state: design-first with the hard rule present
    intake.design_first_required = true;
    intake.must_not_do = ['do not invent emails', 'do not implement frontend visual work without approved design'];
    writeJson(paths.intake, intake);
    let contract = buildExecutionContract(root, requestId).markdown;
    assert.match(contract, /without approved design/, 'design rule must stand while design-first is ON');
    assert.match(contract, /Design-first IS required/);

    // Post-override: rule and policy must flip together — a contract that says
    // "implement now" AND "forbidden to implement" made Codex refuse (live bug).
    intake.design_first_required = false;
    intake.should_implement_now = true;
    writeJson(paths.intake, intake);
    contract = buildExecutionContract(root, requestId).markdown;
    const forbiddenSection = contract.split('## Forbidden')[1].split('##')[0];
    assert.doesNotMatch(forbiddenSection, /without approved design/, 'stale design rule must be filtered');
    assert.match(forbiddenSection, /do not invent emails/, 'other rules must survive');
    assert.match(contract, /Design-first is NOT required/);
  } finally { cleanup(root); }
});
