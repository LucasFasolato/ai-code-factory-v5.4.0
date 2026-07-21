import { aiPath } from '../core/paths.js';
import { writeJson, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { listBacklog } from '../core/state.js';
import { appendEvent } from '../core/events.js';
import { callBrainJson } from './ai-intake-provider.js';
import { scanCodeInsights, insightsDigest } from './code-insight-engine.js';
import { budgetText } from '../core/prompt-budget.js';

// Brain-first feature & weakness recommendation. The brain reasons over real
// code-insight signals to propose prioritized, justified next steps. If the
// brain is unavailable, we fall back to deterministic proposals derived from
// the measured weaknesses — clearly labelled as such, never silently.

const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['feature', 'weakness', 'refactor', 'test', 'infra', 'security', 'performance', 'dx'] },
          value: { type: 'string', enum: ['low', 'medium', 'high'] },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          rationale: { type: 'string' },
          evidence: { type: 'string' },
          suggested_workflow: { type: 'string' }
        },
        required: ['id', 'title', 'kind', 'value', 'effort', 'risk', 'rationale', 'evidence', 'suggested_workflow']
      }
    }
  },
  required: ['summary', 'proposals']
};

const SYSTEM_PROMPT = 'You are the senior product+engineering brain of AI Code Factory. Given real code-insight signals, propose the highest-value next steps: new features that fit the product, plus concrete weaknesses to fix (tests, types, structure, security, CI, DX). Be specific and evidence-based — cite the signal that motivates each item. Prioritize by value vs effort. Return ONLY JSON matching the schema. Do not invent files or facts not present in the signals.';

export async function proposeFeaturesWithBrain(root, config = {}, options = {}) {
  const signals = scanCodeInsights(root);
  const backlog = listBacklog(root).slice(-12).map((r) => ({ id: r.id, title: r.title, status: r.status, work_type: r.work_type }));
  const digest = insightsDigest(signals);
  const prompt = buildProposalPrompt(digest, backlog, signals);

  let source = 'brain';
  let payload;
  try {
    const result = await callBrainJson(prompt, config, {
      jsonSchema: PROPOSAL_SCHEMA,
      schemaName: 'acf_feature_proposals',
      systemPrompt: SYSTEM_PROMPT
    });
    payload = normalizeProposals(result.parsed, signals, 'brain', result.provider);
  } catch (error) {
    source = 'deterministic-fallback';
    payload = { ...deterministicProposals(signals, backlog), brain_error: error.message || String(error) };
  }

  payload.generated_at = nowIso();
  payload.source = source;
  payload.signals_summary = {
    stack: signals.detected_stack,
    source_files: signals.source_files,
    test_ratio: signals.test_ratio,
    weaknesses: signals.deterministic_weaknesses.length
  };
  writeJson(aiPath(root, 'autonomy', 'proposals', 'feature-proposals.json'), payload);
  writeJson(aiPath(root, 'autonomy', 'last-code-insights.json'), signals);
  writeText(aiPath(root, 'autonomy', 'proposals', 'feature-proposals.md'), renderProposals(payload));
  appendEvent(root, 'FEATURES_PROPOSED', { source, count: payload.proposals.length });
  return payload;
}

function buildProposalPrompt(digest, backlog, signals) {
  return [
    '# Task: propose the highest-value next steps for this codebase',
    '',
    '## Code-insight signals (measured, factual)',
    digest,
    '',
    '## Current backlog (recent)',
    backlog.length ? backlog.map((r) => `- ${r.id} [${r.status}] ${r.title}`).join('\n') : '- empty',
    '',
    '## Output contract',
    'Return JSON with `summary` and `proposals[]`. Each proposal needs: id (PROP-NNN), title, kind, value, effort, risk, rationale, evidence (the signal that justifies it), suggested_workflow.',
    'Aim for 4-8 high-quality proposals. Mix new features and weakness fixes. Prioritize value/effort. Cite evidence from the signals above — do not invent.'
  ].join('\n');
}

function normalizeProposals(parsed, signals, source, provider) {
  const proposals = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  const cleaned = proposals.map((p, i) => ({
    id: String(p.id || `PROP-${String(i + 1).padStart(3, '0')}`),
    title: String(p.title || 'Untitled proposal').trim(),
    kind: p.kind || 'feature',
    value: p.value || 'medium',
    effort: p.effort || 'medium',
    risk: p.risk || 'medium',
    rationale: String(p.rationale || '').trim(),
    evidence: String(p.evidence || '').trim(),
    suggested_workflow: String(p.suggested_workflow || 'standard-intake').trim(),
    status: 'proposal'
  })).filter((p) => p.title);
  return {
    summary: String(parsed?.summary || `Brain proposed ${cleaned.length} next step(s) via ${provider}.`).trim(),
    proposals: cleaned.length ? cleaned : deterministicProposals(signals, []).proposals,
    provider
  };
}

// Deterministic fallback: turn measured weaknesses into honest proposals.
function deterministicProposals(signals, backlog) {
  const proposals = [];
  let n = 1;
  const add = (title, kind, value, effort, risk, rationale, evidence, workflow) => {
    proposals.push({ id: `PROP-${String(n++).padStart(3, '0')}`, title, kind, value, effort, risk, rationale, evidence, suggested_workflow: workflow, status: 'proposal' });
  };
  if (!signals.has_tests) add('Establish a test suite and baseline coverage', 'test', 'high', 'medium', 'low', 'No tests detected; untested code is high-risk to change.', 'has_tests=false', 'diagnose-fix-validate');
  else if (signals.test_ratio < 0.1) add('Raise test coverage on core modules', 'test', 'high', 'medium', 'low', 'Test ratio is low relative to source files.', `test_ratio=${signals.test_ratio}`, 'diagnose-fix-validate');
  if (signals.missing_quality_scripts.length) add(`Add missing quality scripts: ${signals.missing_quality_scripts.join(', ')}`, 'dx', 'high', 'low', 'low', 'Quality gates require lint/typecheck/test/build scripts.', `missing=${signals.missing_quality_scripts.join(',')}`, 'direct-patch-with-validation');
  if (!signals.config_present.ci) add('Add a CI workflow (lint + typecheck + test)', 'infra', 'medium', 'low', 'low', 'No CI detected; automated checks prevent regressions.', 'config_present.ci=false', 'direct-patch-with-validation');
  if (!signals.config_present.eslint) add('Introduce ESLint with a shared config', 'dx', 'medium', 'low', 'low', 'No ESLint configuration detected.', 'config_present.eslint=false', 'direct-patch-with-validation');
  if (signals.files_using_any.length) add('Tighten types: remove `any` from core files', 'refactor', 'medium', 'medium', 'low', '`any` usage weakens type safety.', `files_using_any=${signals.files_using_any.length}`, 'behavior-preserving-refactor');
  if (signals.largest_files[0]?.lines > 400) add(`Decompose large file ${signals.largest_files[0].file}`, 'refactor', 'medium', 'medium', 'medium', 'Large files are harder to test and maintain.', `${signals.largest_files[0].file}=${signals.largest_files[0].lines}L`, 'behavior-preserving-refactor');
  if (signals.todo_total > 0) add('Triage and resolve TODO/FIXME markers', 'weakness', 'low', 'low', 'low', 'Outstanding TODO/FIXME markers indicate deferred work.', `todo_total=${signals.todo_total}`, 'standard-intake');
  if (!proposals.length) add('Run a senior quality review pass', 'weakness', 'medium', 'low', 'low', 'No obvious weaknesses; a senior review can find subtler gaps.', 'no deterministic weaknesses', 'standard-intake');
  return { summary: `Deterministic fallback derived ${proposals.length} proposal(s) from measured weaknesses (brain unavailable).`, proposals, provider: 'heuristic' };
}

function renderProposals(payload) {
  return [
    '# Feature & Weakness Proposals',
    '',
    `Generated at: ${payload.generated_at}`,
    `Source: ${payload.source}${payload.provider ? ` (${payload.provider})` : ''}`,
    payload.brain_error ? `Brain error (fell back): ${payload.brain_error}` : '',
    '',
    `## Summary`,
    '',
    payload.summary,
    '',
    '## Proposals',
    '',
    ...payload.proposals.map((p) => [
      `### ${p.id} — ${p.title}`,
      `- Kind: ${p.kind} | Value: ${p.value} | Effort: ${p.effort} | Risk: ${p.risk}`,
      `- Why: ${p.rationale}`,
      `- Evidence: ${p.evidence}`,
      `- Suggested workflow: ${p.suggested_workflow}`,
      ''
    ].join('\n'))
  ].filter(Boolean).join('\n');
}
