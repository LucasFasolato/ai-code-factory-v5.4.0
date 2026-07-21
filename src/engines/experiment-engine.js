import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readJson, writeJson } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';

// Experiment Mode: lightweight A/B harness to compare strategies
// (context, execution, gates, prompts). Records measurements: tokens,
// quality, errors, time, manual corrections.
const EXPERIMENTS_FILE = (root) => aiPath(root, 'experiments', 'experiments.json');

export function startExperiment(root, name, variants = ['A', 'B'], notes = '') {
  if (!name) throw new Error('Usage: npm run ai -- experiment start "<name>" [variantA,variantB]');
  const all = readJson(EXPERIMENTS_FILE(root), []) || [];
  const experiment = {
    id: `EXP-${String(all.length + 1).padStart(3, '0')}`,
    name,
    notes,
    variants: variants.map((v) => ({ name: v, measurements: [] })),
    status: 'running',
    created_at: nowIso()
  };
  all.push(experiment);
  writeJson(EXPERIMENTS_FILE(root), all);
  appendEvent(root, 'EXPERIMENT_RECORDED', { experiment_id: experiment.id, action: 'start', name });
  return experiment;
}

export function recordMeasurement(root, experimentId, variantName, measurement = {}) {
  const all = readJson(EXPERIMENTS_FILE(root), []) || [];
  const experiment = all.find((e) => e.id === experimentId);
  if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);
  const variant = experiment.variants.find((v) => v.name === variantName);
  if (!variant) throw new Error(`Variant not found: ${variantName}. Available: ${experiment.variants.map((v) => v.name).join(', ')}`);
  variant.measurements.push({
    at: nowIso(),
    tokens: numberOrNull(measurement.tokens),
    quality: numberOrNull(measurement.quality),
    errors: numberOrNull(measurement.errors),
    time_ms: numberOrNull(measurement.time_ms),
    manual_corrections: numberOrNull(measurement.manual_corrections),
    request_id: measurement.request_id || null,
    note: measurement.note || null
  });
  writeJson(EXPERIMENTS_FILE(root), all);
  appendEvent(root, 'EXPERIMENT_RECORDED', { experiment_id: experimentId, action: 'measure', variant: variantName });
  return experiment;
}

export function compareExperiment(root, experimentId) {
  const all = readJson(EXPERIMENTS_FILE(root), []) || [];
  const experiment = all.find((e) => e.id === experimentId);
  if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);
  const summary = experiment.variants.map((v) => ({
    variant: v.name,
    samples: v.measurements.length,
    avg_tokens: avg(v.measurements, 'tokens'),
    avg_quality: avg(v.measurements, 'quality'),
    avg_errors: avg(v.measurements, 'errors'),
    avg_time_ms: avg(v.measurements, 'time_ms'),
    avg_manual_corrections: avg(v.measurements, 'manual_corrections')
  }));
  const ranked = [...summary].filter((s) => s.samples > 0).sort((a, b) => (b.avg_quality ?? 0) - (a.avg_quality ?? 0) || (a.avg_errors ?? 0) - (b.avg_errors ?? 0));
  return { experiment_id: experimentId, name: experiment.name, summary, leading_variant: ranked[0]?.variant || null };
}

export function listExperiments(root) {
  return readJson(EXPERIMENTS_FILE(root), []) || [];
}

function avg(measurements, key) {
  const values = measurements.map((m) => m[key]).filter((v) => typeof v === 'number');
  if (!values.length) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
