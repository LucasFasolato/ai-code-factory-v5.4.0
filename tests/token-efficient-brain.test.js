import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { loadConfig } from '../src/core/state.js';
import { buildRoutedBrainContext } from '../src/engines/context-router.js';
import { analyzeAskWithBrain } from '../src/engines/ai-intake-brain.js';
import { readText } from '../src/core/fs.js';
import { requestPaths } from '../src/core/paths.js';

test('context router selects frontend-only summaries and avoids full standards megacontext', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId, intake } = createRequest(root, 'Crear landing premium con hero, servicios y before/after', config);
    const ctx = buildRoutedBrainContext(root, intake.raw_user_ask, requestId, intake, config, { depth: 'standard' });
    assert.ok(ctx.selected_context.includes('design-summary.md'));
    assert.ok(ctx.selected_context.includes('frontend-summary.md'));
    assert.equal(ctx.selected_context.includes('backend-summary.md'), false);
    assert.ok(JSON.stringify(ctx).length < 14000);
  } finally { cleanup(root); }
});

test('Claude provider does not pass long prompts as argv and writes stage trace', async () => {
  const root = makeTempProject();
  const log = path.join(root, 'claude-log.json');
  const mock = path.join(root, 'mock-claude.js');
  fs.writeFileSync(mock, `
const fs = require('node:fs');
const input = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), inputChars: input.length }));
console.log(JSON.stringify({
  intent: 'landing',
  interpreted_intent: 'Create a landing',
  project_type: 'next-landing',
  work_type: 'frontend_visual',
  difficulty: 'medium',
  scope: 'frontend_slice',
  risk: 'medium',
  brain_depth: 'standard',
  reasoning_strategy: 'deliberate',
  confidence: 0.82,
  should_implement_now: false,
  requires_questions: false,
  requires_decomposition: false,
  design_first_required: true,
  requires_research: false,
  requires_human_approval: true,
  needs_visual_acceptance: true,
  missing_info: ['approved visual design'],
  blocking_missing_info: ['approved visual design before implementation'],
  questions: [],
  decisions: [{ decision: 'Use design-first', why: 'Frontend visual work needs approved design', confidence: 0.82 }],
  suggested_workflow: 'design-first',
  next_best_action: 'generate_design_brief',
  tools_needed: ['filesystem', 'design-provider'],
  suggested_reqs: [],
  acceptance_criteria_draft: [],
  must_not_do: ['do not implement without approved design'],
  assumptions_allowed: ['use explicit placeholders'],
  allowed_files_strategy: 'design artifacts only until approved design',
  allowed_files: ['.ai/**'],
  blockers: ['approved visual design before implementation'],
  brain_summary: 'Design-first decision.'
}));
`, 'utf8');
  try {
    const config = loadConfig(root);
    config.ai_intake.provider = 'claude-code';
    config.ai_intake.fallback_chain = ['claude-code', 'heuristic'];
    config.ai_intake.claude_code.command = process.execPath;
    config.ai_intake.claude_code.args = [mock];
    config.ai_intake.claude_code.prompt_mode = 'arg';
    config.ai_intake.claude_code.arg_prompt_max_chars = 100;
    const intake = await analyzeAskWithBrain(root, 'Crear landing premium para FAS Propiedades con hero, servicios, before/after y CTA', 'REQ-777', config, { depth: 'deep' });
    assert.equal(intake.brain.provider, 'claude-code');
    const captured = JSON.parse(fs.readFileSync(log, 'utf8'));
    // v5.0: short CLI flags (--output-format json) are allowed in argv; what must
    // never travel via argv is the prompt itself (breaks Windows on long asks).
    assert.ok(captured.argv.every((a) => a.length < 50), `argv must not carry prompt content: ${JSON.stringify(captured.argv)}`);
    assert.ok(captured.argv.includes('--output-format'), 'deterministic envelope flag should be requested');
    assert.ok(captured.inputChars > 100);
    const trace = readText(path.join(root, '.ai/reasoning/brain/REQ-777-stage-trace.json'), '');
    assert.match(trace, /multi_step_token_efficient/);
  } finally { cleanup(root); }
});
