import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { ensureDir, exists, readJsonSafe, readText, writeJson, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';

export function ensureContextCache(root, config = {}) {
  const max = Number(config.brain_context?.max_summary_chars || 1600);
  const dir = aiPath(root, 'context-cache');
  ensureDir(dir);
  const sources = {
    'project-summary.md': summarizeProject(root, max),
    'frontend-summary.md': summarizeFile(root, aiPath(root, 'standards', 'frontend-conventions.md'), max, frontendFallback()),
    'backend-summary.md': summarizeFile(root, aiPath(root, 'standards', 'backend-conventions.md'), max, backendFallback()),
    'security-summary.md': summarizeFile(root, aiPath(root, 'standards', 'security-conventions.md'), max, securityFallback()),
    'testing-summary.md': summarizeFile(root, aiPath(root, 'standards', 'testing-conventions.md'), max, testingFallback()),
    'design-summary.md': summarizeDesign(root, max),
    'product-summary.md': summarizeProduct(root, max)
  };
  const index = { generated_at: nowIso(), max_summary_chars: max, files: {} };
  for (const [file, content] of Object.entries(sources)) {
    const abs = path.join(dir, file);
    writeText(abs, content.endsWith('\n') ? content : `${content}\n`);
    index.files[file] = { path: `.ai/context-cache/${file}`, chars: content.length };
  }
  writeJson(path.join(dir, 'index.json'), index);
  return index;
}

export function readCachedSummary(root, name, fallback = '') {
  return readText(aiPath(root, 'context-cache', name), fallback);
}

function summarizeProject(root, max) {
  const dna = readJsonSafe(aiPath(root, 'project-dna.json'), {});
  const standards = readJsonSafe(aiPath(root, 'standards', 'project-standards.json'), {});
  const pkg = readJsonSafe(path.join(root, 'package.json'), {});
  return clip([
    '# Project Summary',
    '',
    `Name: ${dna.identity?.name || pkg.name || 'Project'}`,
    `Stack: frontend=${dna.stack?.frontend || standards.frontend?.framework || 'unknown'}; backend=${dna.stack?.backend || standards.backend?.framework || 'unknown'}; db=${dna.stack?.database || standards.backend?.database || 'unknown'}`,
    `Runtime: ${dna.stack?.runtime || 'Node.js'}`,
    '',
    'Must not do:',
    ...((dna.must_not_do || []).slice(0, 8).map((x) => `- ${x}`)),
    '',
    'Quality bar:',
    `- Frontend: ${dna.quality_bar?.frontend_visual || 'premium, accessible, performant'}`,
    `- Backend: ${dna.quality_bar?.backend || 'contracts, validation, tests, security'}`
  ].join('\n'), max);
}

function summarizeDesign(root, max) {
  const taste = readText(aiPath(root, 'knowledge', 'design-taste.md'), designFallback());
  return clip(['# Design Summary', '', taste].join('\n'), max);
}

function summarizeProduct(root, max) {
  const prefs = readJsonSafe(aiPath(root, 'knowledge', 'user-preferences.json'), {});
  return clip([
    '# Product/User Preference Summary',
    '',
    `Interface: ${prefs.interface || 'simple CLI first'}`,
    `Autonomy: ${prefs.autonomy || 'autonomy with gates'}`,
    `Design: ${prefs.design || 'premium and honest'}`,
    `Data policy: ${prefs.data_policy || 'never invent real business data'}`,
    `Stack: ${prefs.stack || 'Next.js/NestJS/PostgreSQL when relevant'}`
  ].join('\n'), max);
}

function summarizeFile(root, file, max, fallback) {
  const raw = exists(file) ? readText(file, fallback) : fallback;
  const lines = raw.split(/\r?\n/).filter((line) => line.trim()).slice(0, 80);
  return clip(lines.join('\n'), max);
}

function clip(s, max) { return String(s || '').length <= max ? String(s || '') : `${String(s).slice(0, max)}\n...[summary clipped]`; }
function frontendFallback() { return '# Frontend Summary\n- Next.js App Router.\n- Page orchestrates; sections/components stay separated.\n- Accessibility, performance, responsive layout and visual evidence matter.\n- Do not add heavy dependencies without approval.'; }
function backendFallback() { return '# Backend Summary\n- NestJS modular feature architecture.\n- DTO validation for external input.\n- Controllers delegate to services; repositories encapsulate persistence.\n- Tests proportional to risk.'; }
function securityFallback() { return '# Security Summary\n- No secrets in source.\n- Validate input.\n- Auth/authz changes require approval.\n- Safe errors and no sensitive logging.'; }
function testingFallback() { return '# Testing Summary\n- Low risk: smoke/unit.\n- Medium: happy path + validation + error cases.\n- High: integration + permissions + edge cases.'; }
function designFallback() { return '# Design Taste\n- Premium, sober, professional.\n- Strong hierarchy, no typographic gigantism.\n- Mobile-first and honest placeholders.'; }
