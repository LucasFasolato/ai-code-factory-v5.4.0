import fs from 'node:fs';
import path from 'node:path';
import { VERSION, DEFAULT_CONFIG, DEFAULT_STATE, DIRECTORY_LAYOUT, PLAYBOOKS, DEFINITIONS_OF_DONE, MCP_REGISTRY, KNOWN_FAILURES, QUALITY_RUBRIC, PROJECT_DNA, USER_PREFERENCES, DESIGN_TASTE, ENGINEERING_TASTE } from '../defaults.js';
import { aiPath } from './paths.js';
import { ensureDir, exists, readJson, readJsonSafe, writeJson, writeText, readText } from './fs.js';
import { nowIso } from './format.js';
import { withLock } from './lock.js';

export function ensureAiWorkspace(root) {
  for (const dir of DIRECTORY_LAYOUT) ensureDir(path.join(root, dir));

  const seedJson = (file, value) => { if (!exists(file)) writeJson(file, value); };
  const seedText = (file, value) => { if (!exists(file)) writeText(file, value); };

  seedJson(aiPath(root, 'config.json'), DEFAULT_CONFIG);

  // v5.1: version migration. The doctor tells users to run `init` to fix
  // config/code version drift, so init must actually re-stamp existing
  // configs (user settings preserved, only the version field moves).
  const existingConfig = readJsonSafe(aiPath(root, 'config.json'), null);
  if (existingConfig && existingConfig.version && existingConfig.version !== VERSION) {
    writeJson(aiPath(root, 'config.json'), { ...existingConfig, previous_version: existingConfig.version, version: VERSION });
  }
  seedText(aiPath(root, 'config.local.example.json'), JSON.stringify({ ai_intake: { enabled: true, provider: 'claude-code', fallback_chain: ['claude-code', 'openai', 'heuristic'], model: 'gpt-4.1', api_key_env: 'OPENAI_API_KEY', claude_code: { command: 'claude', args: ['-p'], prompt_mode: 'stdin' } }, brain_routing: { external_min_difficulty: 'medium' } }, null, 2) + '\n');
  seedJson(aiPath(root, 'state.json'), { ...DEFAULT_STATE, created_at: nowIso(), updated_at: nowIso() });
  seedJson(aiPath(root, 'mcp', 'registry.json'), MCP_REGISTRY);
  seedJson(aiPath(root, 'mcp', 'tool-capabilities.json'), MCP_REGISTRY);
  seedJson(aiPath(root, 'mcp', 'tool-usage-log.json'), []);
  seedJson(aiPath(root, 'memory', 'mistakes', 'known-failures.json'), KNOWN_FAILURES);
  seedText(aiPath(root, 'memory', 'project-lessons.md'), '# Project Lessons\n\nNo consolidated lessons yet.\n');

  // Evolution layer seeds
  seedJson(aiPath(root, 'project-dna.json'), PROJECT_DNA);
  seedJson(aiPath(root, 'knowledge', 'user-preferences.json'), { ...USER_PREFERENCES, updated_at: nowIso() });
  seedText(aiPath(root, 'knowledge', 'design-taste.md'), DESIGN_TASTE);
  seedText(aiPath(root, 'knowledge', 'engineering-taste.md'), ENGINEERING_TASTE);
  seedJson(aiPath(root, 'constraints.json'), { locked_constraints: [] });
  seedJson(aiPath(root, 'feedback', 'feedback-log.json'), []);
  seedJson(aiPath(root, 'standards', 'project-standards.json'), { quality_profile: 'production', frontend: { framework: 'Next.js App Router' }, backend: { framework: 'NestJS' }, generated_by: 'default-seed' });
  seedText(aiPath(root, 'standards', 'frontend-conventions.md'), '# Frontend Conventions\n\nRun `npm run ai -- standards init` to regenerate full standards.\n');
  seedText(aiPath(root, 'standards', 'backend-conventions.md'), '# Backend Conventions\n\nRun `npm run ai -- standards init` to regenerate full standards.\n');
  seedText(aiPath(root, 'standards', 'testing-conventions.md'), '# Testing Conventions\n\nRisk-based testing.\n');
  seedText(aiPath(root, 'standards', 'security-conventions.md'), '# Security Conventions\n\nNo hardcoded secrets, validate input, safe errors.\n');
  seedText(aiPath(root, 'standards', 'folder-structure.md'), '# Folder Structure\n\nUse project conventions.\n');
  seedJson(aiPath(root, 'standards', 'dependency-policy.json'), { require_approval_for: ['large UI kits', 'auth/payment/security packages'] });

  const intelligenceDir = aiPath(root, 'intelligence');
  ensureDir(intelligenceDir);
  seedText(aiPath(root, 'intelligence', 'quality-rubric.md'), QUALITY_RUBRIC);

  for (const [file, content] of Object.entries(PLAYBOOKS)) {
    seedText(aiPath(root, 'playbooks', file), content);
  }

  for (const [file, content] of Object.entries(DEFINITIONS_OF_DONE)) {
    seedJson(aiPath(root, 'definitions-of-done', file), content);
  }

  seedJson(aiPath(root, 'dashboard', 'config.json'), DEFAULT_CONFIG.dashboard);
}

export function loadConfig(root) {
  ensureAiWorkspace(root);
  loadDotEnv(root);
  const loaded = readJsonSafe(aiPath(root, 'config.json'), {});
  const local = readJsonSafe(aiPath(root, 'config.local.json'), {});
  return deepMerge(deepMerge(DEFAULT_CONFIG, loaded || {}), local || {});
}

function loadDotEnv(root) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}


export function saveConfig(root, config) {
  writeJson(aiPath(root, 'config.json'), config);
}

export function loadState(root) {
  ensureAiWorkspace(root);
  return readJsonSafe(aiPath(root, 'state.json'), { ...DEFAULT_STATE, created_at: nowIso(), updated_at: nowIso() });
}

export function saveState(root, state) {
  writeJson(aiPath(root, 'state.json'), { ...state, updated_at: nowIso() });
}

export function nextRequestId(root) {
  const stateFile = aiPath(root, 'state.json');
  return withLock(stateFile, () => {
    const state = loadState(root);
    const next = Number(state.request_counter || 0) + 1;
    state.request_counter = next;
    const id = `REQ-${String(next).padStart(3, '0')}`;
    state.active_request_id = id;
    saveState(root, state);
    return id;
  });
}

export function getActiveRequestId(root, explicit = null) {
  if (explicit) return explicit;
  const state = loadState(root);
  return state.active_request_id;
}

export function setActiveRequestId(root, requestId) {
  const state = loadState(root);
  state.active_request_id = requestId;
  saveState(root, state);
}

export function listBacklog(root) {
  ensureAiWorkspace(root);
  const dir = aiPath(root, 'backlog');
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonSafe(path.join(dir, name), null))
    .filter(Boolean)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function loadRequest(root, requestId) {
  return readJsonSafe(aiPath(root, 'backlog', `${requestId}.json`), null);
}

export function saveRequest(root, request) {
  writeJson(aiPath(root, 'backlog', `${request.id}.json`), { ...request, updated_at: nowIso() });
}

export function updateRequest(root, requestId, patch) {
  const current = loadRequest(root, requestId) || { id: requestId, created_at: nowIso() };
  const next = { ...current, ...patch, updated_at: nowIso() };
  saveRequest(root, next);
  return next;
}

export function readArtifact(root, relativePath, fallback = '') {
  return readText(path.join(root, relativePath), fallback);
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override === undefined ? base : override;
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = deepMerge(base[key], value);
  return out;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
