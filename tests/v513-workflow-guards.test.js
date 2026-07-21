import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { requestPaths } from '../src/core/paths.js';
import { readJson, writeJson, appendText } from '../src/core/fs.js';
import { updateRequest } from '../src/core/state.js';
import { runFullCycle } from '../src/engines/full-cycle-engine.js';
import { normalizeBrainDecision } from '../src/engines/intake-schema.js';
import { runStateDoctor } from '../src/engines/state-doctor.js';

// v5.1.3 guards — all three found in the first fully-live v5.1.2 run.

test('cycle stops on needs_input with unanswered blocking questions, proceeds once answered', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'agregar seccion de contacto en la home');
    const paths = requestPaths(root, requestId);
    const intake = readJson(paths.intake, {});
    intake.brain = { source: 'ai', provider: 'mock' };
    intake.blocking_missing_info = ['form submission behavior'];
    intake.requires_human_approval = false;
    intake.design_first_required = false;
    writeJson(paths.intake, intake);
    updateRequest(root, requestId, { status: 'needs_input' });

    const stopped = runFullCycle(root, requestId, {}, {});
    assert.equal(stopped.status, 'stopped');
    assert.match(stopped.stopped_reason, /blocking question/i, `cycle must not implement on guesses: ${stopped.stopped_reason}`);
    assert.match(stopped.next_action, /answer/i);
    // Nothing was executed: no branch/execute steps beyond none at all.
    assert.ok(!stopped.steps.some((s) => s.step === 'execute'), 'executor must never run before answers');

    // Answering unblocks the guard (cycle will stop later for other reasons in
    // this bare temp project, but NOT for blocking questions).
    appendText(paths.answersMd, '\n## Answer\n\nStatic form, no backend submission.\n');
    const resumed = runFullCycle(root, requestId, {}, {});
    assert.doesNotMatch(resumed.stopped_reason || '', /blocking question/i);
  } finally { cleanup(root); }
});

test('brain decisions with object items in missing-info arrays never render as [object Object]', () => {
  const decision = normalizeBrainDecision({
    intent: 'x',
    work_type: 'small_change',
    blocking_missing_info: [
      'plain string question',
      { question: 'form submission behavior', why: 'unspecified' },
      { text: 'CSS approach in use' }
    ]
  });
  assert.deepEqual(decision.blocking_missing_info, ['plain string question', 'form submission behavior', 'CSS approach in use']);
  assert.ok(!decision.blocking_missing_info.some((i) => i.includes('[object Object]')));
});

test('state doctor treats a fresh project (empty backlog, no active request) as healthy', () => {
  const root = makeTempProject();
  try {
    const result = runStateDoctor(root);
    assert.ok(!result.issues.some((i) => i.id === 'no-active-request'), `fresh project must be healthy: ${JSON.stringify(result.issues)}`);
  } finally { cleanup(root); }
});
