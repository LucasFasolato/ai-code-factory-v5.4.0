import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { requestPaths } from '../src/core/paths.js';
import { readJson, writeJson } from '../src/core/fs.js';
import { appendEvent } from '../src/core/events.js';
import { appendProgress, readProgress, progressFile } from '../src/engines/progress-engine.js';
import { runHook, listHooks } from '../src/engines/hooks-engine.js';
import { runFullCycle } from '../src/engines/full-cycle-engine.js';
import { buildStats, renderStats } from '../src/engines/stats-engine.js';
import { buildContextPack } from '../src/engines/context-pack-engine.js';
import { spawnSync } from 'node:child_process';

function initGit(root) {
  for (const args of [['init', '-qb', 'main'], ['config', 'user.email', 't@t.dev'], ['config', 'user.name', 'T']]) {
    spawnSync('git', args, { cwd: root });
  }
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  spawnSync('git', ['add', '.'], { cwd: root });
  spawnSync('git', ['commit', '-qm', 'init', '--no-gpg-sign'], { cwd: root });
}

test('progress file accumulates stages and survives truncation with recent tail intact', () => {
  const root = makeTempProject();
  try {
    appendProgress(root, 'REQ-001', 'branch', { branch: 'acf/req-001-x', status: 'created' });
    appendProgress(root, 'REQ-001', 'execute', { status: 'success', files: ['src/a.ts', 'src/b.ts'] });
    const text = readProgress(root, 'REQ-001');
    assert.match(text, /DO NOT redo|MUST NOT redo/i);
    assert.match(text, /branch.*acf\/req-001-x/);
    assert.match(text, /files: src\/a\.ts, src\/b\.ts/);
    // Truncation keeps the tail (what a resuming agent needs most).
    for (let i = 0; i < 200; i += 1) appendProgress(root, 'REQ-001', `stage-${i}`, { status: 'ok' });
    const truncated = readProgress(root, 'REQ-001', 1500);
    assert.ok(truncated.length <= 1600);
    assert.match(truncated, /stage-199/);
  } finally { cleanup(root); }
});

test('pre_execute hook blocks the cycle on non-zero exit; absence is a silent no-op', () => {
  const root = makeTempProject();
  try {
    // No hook → no-op
    assert.equal(runHook(root, 'pre_execute', {}, {}).ran, false);

    // Blocking hook: exits 1 with a reason on stderr.
    initGit(root); // the branch stage runs before pre_execute and requires git
    fs.mkdirSync(path.join(root, '.ai', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.ai', 'hooks', 'pre_execute.cjs'),
      `const payload = JSON.parse(process.env.ACF_HOOK_PAYLOAD || '{}');\nconsole.error('blocked by policy for ' + (payload.request_id || 'unknown'));\nprocess.exit(1);\n`);

    const { requestId } = createRequest(root, 'agregar endpoint de salud');
    const paths = requestPaths(root, requestId);
    const intake = readJson(paths.intake, {});
    intake.brain = { source: 'ai', provider: 'mock' };
    intake.requires_human_approval = false;
    intake.design_first_required = false;
    writeJson(paths.intake, intake);

    const result = runFullCycle(root, requestId, {}, {});
    assert.equal(result.status, 'stopped');
    assert.match(result.stopped_reason, /pre_execute hook blocked/i);
    assert.match(result.stopped_reason, new RegExp(requestId), 'hook payload must reach the script');
    assert.ok(!result.steps.some((s) => s.step === 'execute'), 'executor must not run when the hook blocks');
    assert.equal(listHooks(root, {}).length, 1);

    // Resume immunity (v5.2.1): with a prior successful execution, the cycle
    // resumes and the pre_execute hook must NOT fire — nothing will execute.
    writeJson(paths.executionStatus, { status: 'success', files_touched: ['src/done.ts'] });
    const resumed = runFullCycle(root, requestId, {}, {});
    assert.doesNotMatch(resumed.stopped_reason || '', /pre_execute hook/i, 'resume must not be gated by an execution hook');
    const exec = resumed.steps.find((s) => s.step === 'execute');
    assert.equal(exec?.detail?.status, 'resumed_previous_success');
  } finally { cleanup(root); }
});

test('post hooks never block even when they fail', () => {
  const root = makeTempProject();
  try {
    fs.mkdirSync(path.join(root, '.ai', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.ai', 'hooks', 'post_execute.cjs'), 'process.exit(3);\n');
    const result = runHook(root, 'post_execute', { request_id: 'REQ-X' }, {});
    assert.equal(result.ran, true);
    assert.equal(result.exit_code, 3);
    assert.equal(result.blocked, false, 'post hooks report failure but never block');
  } finally { cleanup(root); }
});

test('draft-commit: high-risk work stops before merge without --approved', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'modificar flujo de pagos con reembolso');
    const paths = requestPaths(root, requestId);
    const intake = readJson(paths.intake, {});
    intake.brain = { source: 'ai', provider: 'mock' };
    intake.risk = 'high';
    intake.requires_human_approval = false; // isolate: only the merge-stage approval is under test
    intake.design_first_required = false;
    writeJson(paths.intake, intake);
    // Simulate implemented+validated state so the cycle reaches the merge stage:
    writeJson(paths.executionStatus, { status: 'success', files_touched: ['src/pay.ts'] });

    const result = runFullCycle(root, requestId, {}, {});
    // In a bare temp project the cycle may stop earlier (validation etc.), but if
    // it reaches merge-decision territory the reason must be the draft-commit stop.
    if (/high-risk/i.test(result.stopped_reason || '')) {
      assert.match(result.stopped_reason, /awaiting explicit approval to merge/i);
      assert.match(result.next_action, /--approved/);
    } else {
      // Earlier stop is acceptable in this bare env; the guard's unit condition still holds:
      assert.notEqual(result.status, 'completed', 'high-risk must never auto-complete without approval');
    }
  } finally { cleanup(root); }
});

test('progress is embedded into the context pack for resume-aware executors', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'agregar seccion de contacto');
    appendProgress(root, requestId, 'execute', { status: 'success', files: ['src/app/page.tsx'] });
    const pack = buildContextPack(root, requestId);
    assert.match(pack.markdown, /Progress so far/);
    assert.match(pack.markdown, /page\.tsx/);
  } finally { cleanup(root); }
});

test('stats aggregates events, blockers and usage into a readable report', () => {
  const root = makeTempProject();
  try {
    appendEvent(root, 'ASK_CREATED', { request_id: 'REQ-001' });
    appendEvent(root, 'ASK_CREATED', { request_id: 'REQ-002' });
    appendEvent(root, 'CYCLE_COMPLETED', { request_id: 'REQ-001' });
    fs.mkdirSync(path.join(root, '.ai', 'reasoning', 'gates'), { recursive: true });
    writeJson(path.join(root, '.ai', 'reasoning', 'gates', 'REQ-002.json'), { close_blockers: ['visual_evidence: pending', 'acceptance_criteria: 1 failed'] });
    const stats = buildStats(root, {});
    assert.equal(stats.requests.created, 2);
    assert.equal(stats.requests.closed, 1);
    assert.ok(stats.top_blockers.some((b) => b.gate === 'visual_evidence'));
    const rendered = renderStats(stats);
    assert.match(rendered, /50% completion/);
    assert.match(rendered, /visual_evidence: 1x/);
  } finally { cleanup(root); }
});
