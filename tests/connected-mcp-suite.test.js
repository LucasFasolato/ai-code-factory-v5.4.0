import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { loadConfig } from '../src/core/state.js';
import { generateDesignPromptPack } from '../src/engines/design-engine.js';
import { requestPaths } from '../src/core/paths.js';
import { readJson, readText } from '../src/core/fs.js';
import { setMcpToolEnabled, mcpDoctor } from '../src/engines/mcp-router.js';
import { generateComponentPlan } from '../src/engines/component-engine.js';

test('wireframe-mock provider generates real design artifacts and rich prompt pack', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    config.design.default_provider = 'wireframe-mock';
    const { requestId } = createRequest(root, 'Crear landing simple y elegante para FAS Propiedades con hero, servicios, before/after y CTA', config);
    const result = generateDesignPromptPack(root, requestId, config);
    assert.equal(result.manifest.status, 'generated');
    assert.equal(result.manifest.options.length, 3);
    assert.ok(result.manifest.options.every((item) => item.artifacts_exist));
    const prompt = readText(requestPaths(root, requestId).designBrief, '') + '\n' + readText(result.prompt_file, '');
    assert.match(prompt, /Visual Requirements/i);
    assert.match(prompt, /FAS Propiedades/i);
  } finally { cleanup(root); }
});

test('mcp tools can be enabled/disabled and doctor stays healthy', () => {
  const root = makeTempProject();
  try {
    const tool = setMcpToolEnabled(root, 'browser-search', true);
    assert.equal(tool.enabled, true);
    const report = mcpDoctor(root);
    assert.equal(report.status, 'ok');
  } finally { cleanup(root); }
});

test('component planner creates a component plan file', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing con hero, servicios, before/after y CTA de contacto', config);
    const result = generateComponentPlan(root, requestId, config);
    assert.equal(result.components.length >= 4, true);
    assert.match(readText(result.path, ''), /HeroSection/);
    assert.match(readText(result.path, ''), /BeforeAfterGallery/);
  } finally { cleanup(root); }
});
