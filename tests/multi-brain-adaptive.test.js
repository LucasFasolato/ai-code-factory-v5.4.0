import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup } from './helpers.js';
import { loadConfig } from '../src/core/state.js';
import { previewAskWithBrain } from '../src/engines/ai-intake-brain.js';
import { runIntakeProvider } from '../src/engines/ai-intake-provider.js';
import { sanitizeBrainContext, redactSecrets } from '../src/engines/brain-context-sanitizer.js';
import { parseProviderJson } from '../src/core/json-utils.js';

function decisionJson(extra = {}) {
  return {
    intent: 'Crear endpoint simple',
    interpreted_intent: 'Crear endpoint simple validado',
    project_type: 'nest-api',
    work_type: 'backend_api',
    difficulty: 'medium',
    scope: 'backend_slice',
    risk: 'medium',
    brain_depth: 'standard',
    reasoning_strategy: 'deliberate',
    confidence: 0.86,
    should_implement_now: true,
    requires_questions: false,
    requires_decomposition: false,
    design_first_required: false,
    requires_research: false,
    requires_human_approval: false,
    needs_visual_acceptance: false,
    missing_info: [],
    blocking_missing_info: [],
    questions: [],
    decisions: [{ decision: 'Use backend contract workflow', why: 'Single endpoint with bounded scope.', confidence: 0.86 }],
    suggested_workflow: 'backend-contract-first',
    next_best_action: 'preview then approve execution',
    tools_needed: ['filesystem'],
    suggested_reqs: [],
    acceptance_criteria_draft: ['Endpoint returns expected payload.'],
    must_not_do: ['Do not invent real business data.'],
    assumptions_allowed: [],
    allowed_files_strategy: 'backend files only',
    allowed_files: ['src/**/*.ts', 'tests/**/*.ts'],
    blockers: [],
    brain_summary: 'clean',
    ...extra
  };
}

test('adaptive Brain routing skips external provider only for trivial asks', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const preview = await previewAskWithBrain(root, 'ok', config);
    assert.equal(preview.route.provider, 'heuristic');
    assert.equal(preview.route.use_external_brain, false);
    assert.equal(preview.route.depth, 'fast');
    assert.equal(preview.route.reasoning_strategy, 'direct');
  } finally { cleanup(root); }
});

test('brain-first: a simple real ask still thinks with Claude', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const preview = await previewAskWithBrain(root, 'Cambiar texto del botón Enviar a Consultar', config);
    assert.equal(preview.route.use_external_brain, true);
    assert.equal(preview.route.provider, 'claude-code');
  } finally { cleanup(root); }
});

test('adaptive Brain routing sends epic asks to Claude Code with architect/tree mode', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const preview = await previewAskWithBrain(root, 'Quiero una app tipo Vinted para tesis con usuarios, publicaciones, ofertas, chat y pagos simulados', config);
    assert.equal(preview.route.provider, 'claude-code');
    assert.equal(preview.route.use_external_brain, true);
    assert.equal(preview.route.depth, 'architect');
    assert.equal(preview.route.reasoning_strategy, 'tree');
    assert.deepEqual(preview.route.fallback_chain.slice(0, 3), ['claude-code', 'openai', 'heuristic']);
  } finally { cleanup(root); }
});

test('Claude Code provider parses fenced JSON and strips API env from child process', async () => {
  const root = makeTempProject();
  const script = path.join(root, 'fake-claude-provider.mjs');
  const payload = decisionJson({ brain_summary: 'will-be-overwritten' });
  fs.writeFileSync(script, `
const data = ${JSON.stringify(payload)};
data.brain_summary = process.env.OPENAI_API_KEY ? 'leaked' : 'clean';
console.log('Here is the structured decision:');
console.log(JSON.stringify(data));
console.log('End.');
`);
  const oldKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'sk-test-should-not-reach-child';
    const config = {
      ...loadConfig(root),
      ai_intake: {
        enabled: true,
        provider: 'claude-code',
        fallback_chain: ['claude-code', 'heuristic'],
        claude_code: { command: process.execPath, args: [script], prompt_mode: 'stdin', timeout_ms: 10000, sanitize_api_env: true }
      }
    };
    const result = await runIntakeProvider('Analyze this ask and return JSON', config, { route: { provider: 'claude-code', fallback_chain: ['claude-code', 'heuristic'], max_prompt_chars: 12000 } });
    assert.equal(result.provider, 'claude-code');
    assert.equal(result.parsed.brain_summary, 'clean');
    assert.equal(result.extracted_json, true);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    cleanup(root);
  }
});

test('provider JSON extractor accepts prose-wrapped structured output', () => {
  const parsed = parseProviderJson(`Claro.\n\n\`\`\`json\n${JSON.stringify(decisionJson())}\n\`\`\``);
  assert.equal(parsed.parsed.work_type, 'backend_api');
  assert.equal(parsed.extracted, true);
});

test('Brain context sanitizer redacts secrets and applies depth limits', () => {
  const raw = {
    ask: 'test',
    compiled_knowledge: 'x'.repeat(10000),
    design_taste: 'y'.repeat(5000),
    project_map: { detected_files: Array.from({ length: 200 }, (_, i) => `src/file-${i}.ts`) },
    env: { OPENAI_API_KEY: 'sk-secretshouldberemoved1234567890' },
    text: 'token=abc123 password=hunter2'
  };
  const { context, limits } = sanitizeBrainContext(raw, { depth: 'fast', reasoning_strategy: 'direct' }, {});
  assert.equal(context.env.OPENAI_API_KEY, '[REDACTED]');
  assert.ok(context.compiled_knowledge.length <= limits.compiled + 100);
  assert.ok(context.project_map.detected_files.length <= limits.files);
  assert.equal(redactSecrets('OPENAI_API_KEY=sk-secretshouldberemoved1234567890').includes('sk-secret'), false);
});

import { buildWindowsCommandLine, quoteWindowsArg } from '../src/core/spawn-portable.js';

test('portable spawn helper quotes Windows command scripts safely', () => {
  const line = buildWindowsCommandLine('C:\\Users\\fasol\\AppData\\Roaming\\npm\\claude.cmd', ['-p', 'hello world']);
  assert.equal(line, 'C:\\Users\\fasol\\AppData\\Roaming\\npm\\claude.cmd -p "hello world"');
  assert.equal(quoteWindowsArg('plain'), 'plain');
  assert.equal(quoteWindowsArg('has space'), '"has space"');
});
