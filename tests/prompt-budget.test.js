import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { budgetText, planPromptTransport, promptSizeReport, ARGV_SAFE_LIMIT, PROMPT_HARD_LIMIT } from '../src/core/prompt-budget.js';
import { buildExecutorCommand, runExecutor } from '../src/engines/executor-orchestrator.js';
import { saveExecutionContract } from '../src/engines/execution-contract-engine.js';
import { loadConfig } from '../src/core/state.js';
import { requestPaths } from '../src/core/paths.js';

test('budgetText truncates oversized content on a boundary and annotates it', () => {
  const big = 'line one\n\n' + 'x'.repeat(50000);
  const out = budgetText(big, 1000);
  assert.ok(out.length < 1300);
  assert.match(out, /truncated \d+ chars/);
});

test('budgetText leaves small content untouched', () => {
  assert.equal(budgetText('hello', 1000), 'hello');
});

test('planPromptTransport routes oversized prompts away from argv', () => {
  assert.equal(planPromptTransport('x'.repeat(ARGV_SAFE_LIMIT + 1)).transport, 'file-stdin');
  assert.equal(planPromptTransport('small', { preferred: 'arg' }).transport, 'arg');
});

test('promptSizeReport flags argv and hard-limit overflow', () => {
  assert.equal(promptSizeReport('x'.repeat(100)).fits_argv, true);
  assert.equal(promptSizeReport('x'.repeat(ARGV_SAFE_LIMIT + 1)).fits_argv, false);
  assert.equal(promptSizeReport('x'.repeat(PROMPT_HARD_LIMIT + 1)).over_hard_limit, true);
});

test('buildExecutorCommand never lets the argv instruction exceed the argv-safe limit', () => {
  const giant = 'INSTRUCTION '.repeat(20000); // ~240 KB
  const built = buildExecutorCommand('codex', { execution: { codex: { command: 'codex', args: ['exec', '-C'] } } }, '/tmp/x', giant);
  const lastArg = built.args[built.args.length - 1];
  assert.ok(lastArg.length <= ARGV_SAFE_LIMIT, `argv instruction was ${lastArg.length} chars`);
});

test('contract embeds a bounded context pack even when the pack is huge', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'endpoint NestJS productos con validación', config);
    // Inflate the context pack to 130 KB.
    fs.writeFileSync(requestPaths(root, requestId).contextPack, '# Big\n\n' + 'lorem '.repeat(25000));
    const result = saveExecutionContract(root, requestId);
    assert.ok(result.markdown.length < 30000, `contract was ${result.markdown.length} chars`);
    assert.match(result.markdown, /truncated/i);
  } finally { cleanup(root); }
});

test('executor passes a tiny file-referencing instruction despite a huge context', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'endpoint NestJS productos', config);
    fs.writeFileSync(requestPaths(root, requestId).contextPack, '# Big\n\n' + 'lorem '.repeat(25000));

    // Mock codex that records the instruction length it received.
    const codex = path.join(root, 'mock-codex.cjs');
    fs.writeFileSync(codex, `const fs=require('node:fs');const path=require('node:path');console.log('args:'+(process.argv.length-2));const dir=path.join(process.cwd(),'src');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'f-'+Date.now()+'-'+Math.floor(Math.random()*1e6)+'.ts'),'export const x=1;\\n');`);
    config.execution = { enabled: true, primary: 'codex', codex: { command: process.execPath, args: [codex, 'exec', '-C'] }, dry_run_when_missing_executor: true };

    const result = runExecutor(root, requestId, config, {});
    if (result.instruction_chars !== undefined) {
      assert.ok(result.instruction_chars <= ARGV_SAFE_LIMIT, `instruction was ${result.instruction_chars} chars`);
      assert.ok(result.instruction_chars < 2000, 'file-referencing instruction should be small');
    }
  } finally { cleanup(root); }
});
