import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readJsonSafe, writeJson, ensureDir } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { analyzeAsk } from './intake-engine.js';

// v5.0 Brain Eval — the harness has regression tests for its code; this gives
// it regression tests for its intelligence. A golden set of real asks with
// expected classifications; every prompt/model change gets measured against it
// instead of eyeballed. Runs on the zero-cost heuristic layer by default so a
// full eval costs nothing.

export function goldenDir(root) {
  return aiPath(root, 'golden');
}

export function seedGoldenSet(root) {
  ensureDir(goldenDir(root));
  const seeds = [
    { id: 'golden-001', ask: 'Agregá un endpoint para cancelar reservas con devolución parcial', expected: { work_type: 'backend_api', risk: 'high' } },
    { id: 'golden-002', ask: 'Cambiá el color del botón principal a azul', expected: { work_type: 'small_change' } },
    { id: 'golden-003', ask: 'Armá una landing premium para el estudio jurídico', expected: { work_type: 'frontend_visual', design_first_required: true } },
    { id: 'golden-004', ask: 'Hay un bug: el login falla cuando el email tiene mayúsculas', expected: { work_type: 'bugfix' } },
    { id: 'golden-005', ask: 'Implementá el flujo completo de checkout con pagos', expected: { work_type: 'fullstack_feature', risk: 'high' } },
    // Real-world ask that misclassified as design-first frontend_visual in v5.0.2
    // (Spanish word order broke the "sección simple" pattern). Captured forever.
    { id: 'golden-006', ask: 'Agregá una sección de contacto simple en la home con nombre, email y mensaje', expected: { work_type: 'small_change', design_first_required: false } }
  ];
  let created = 0;
  for (const seed of seeds) {
    const file = path.join(goldenDir(root), `${seed.id}.json`);
    if (!fs.existsSync(file)) { writeJson(file, seed); created += 1; }
  }
  return { created, dir: goldenDir(root) };
}

export function listGoldenCases(root) {
  const dir = goldenDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJsonSafe(path.join(dir, f), null))
    .filter((c) => c && c.ask && c.expected);
}

export async function runBrainEval(root, config = {}, options = {}) {
  const cases = listGoldenCases(root);
  if (!cases.length) return { total: 0, note: 'No golden cases. Run `brain-eval init` first, then add real asks you care about.' };
  const results = [];
  for (const goldenCase of cases) {
    const actual = await classify(root, goldenCase.ask, config, options);
    const fields = Object.keys(goldenCase.expected);
    const mismatches = fields.filter((f) => normalize(actual[f]) !== normalize(goldenCase.expected[f]));
    results.push({
      id: goldenCase.id,
      ask: goldenCase.ask.slice(0, 90),
      passed: mismatches.length === 0,
      mismatches: mismatches.map((f) => ({ field: f, expected: goldenCase.expected[f], actual: actual[f] ?? null }))
    });
  }
  const passed = results.filter((r) => r.passed).length;
  const report = {
    generated_at: nowIso(),
    mode: options.useBrain ? 'brain' : 'heuristic',
    total: results.length,
    passed,
    accuracy: Number((passed / results.length).toFixed(3)),
    results
  };
  ensureDir(aiPath(root, 'history', 'scores'));
  writeJson(aiPath(root, 'history', 'scores', 'brain-eval-latest.json'), report);
  return report;
}

async function classify(root, ask, config, options) {
  if (options.useBrain) {
    const { analyzeAskWithBrain } = await import('./ai-intake-brain.js');
    try {
      const intake = await analyzeAskWithBrain(root, ask, `EVAL-${Date.now()}`, config, {});
      return intake;
    } catch {
      return analyzeAsk(ask, 'EVAL-fallback', config);
    }
  }
  return analyzeAsk(ask, 'EVAL-heuristic', config);
}

function normalize(value) {
  if (value === undefined || value === null) return null;
  return String(value).toLowerCase();
}
