import fs from 'node:fs';
import path from 'node:path';
import { readText, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';

// v5.0 Git Policy — hybrid .ai versioning. Auditable knowledge (config, DNA,
// standards, approved designs, evidence, specs, playbooks, golden set) stays
// in git; runtime noise (events, caches, raw brain traces, usage ledger) is
// ignored. Configurable via config.git.version_ai_state = minimal|full|none.

const MANAGED_START = '# acf:git-policy:start';
const MANAGED_END = '# acf:git-policy:end';

const RUNTIME_IGNORES = [
  '.ai/events/',
  '.ai/history/replays/',
  '.ai/context-cache/',
  '.ai/execution/logs/',
  '.ai/execution/status/',
  '.ai/reasoning/brain/raw/',
  '.ai/usage/',
  '.ai/state.json',
  '.ai/locks/',
  '.ai/progress/'
];

export function gitPolicyStatus(root, config = {}) {
  const mode = policyMode(config);
  const gitignore = readText(path.join(root, '.gitignore'), '');
  const managed = gitignore.includes(MANAGED_START);
  return {
    mode,
    managed_block_present: managed,
    runtime_ignores: mode === 'minimal' ? RUNTIME_IGNORES : (mode === 'none' ? ['.ai/'] : []),
    note: mode === 'full' ? 'Everything under .ai/ is versioned (noisy but fully auditable).' : mode === 'none' ? 'Nothing under .ai/ is versioned.' : 'Hybrid: knowledge versioned, runtime noise ignored.'
  };
}

export function applyGitPolicy(root, config = {}) {
  const mode = policyMode(config);
  const file = path.join(root, '.gitignore');
  const existing = readText(file, '');
  const lines = mode === 'full' ? [] : (mode === 'none' ? ['.ai/'] : RUNTIME_IGNORES);
  const block = [MANAGED_START, `# Applied ${nowIso()} (mode: ${mode}). Managed by \`npm run ai -- git-policy apply\`.`, ...lines, MANAGED_END].join('\n');
  let next;
  if (existing.includes(MANAGED_START) && existing.includes(MANAGED_END)) {
    const before = existing.slice(0, existing.indexOf(MANAGED_START));
    const after = existing.slice(existing.indexOf(MANAGED_END) + MANAGED_END.length);
    next = `${before}${block}${after}`;
  } else {
    next = existing.trim() ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
  }
  writeText(file, next);
  return { mode, gitignore: file, lines_managed: lines.length };
}

function policyMode(config = {}) {
  const mode = process.env.ACF_GIT_AI_POLICY || config.git?.version_ai_state || 'minimal';
  return ['minimal', 'full', 'none'].includes(mode) ? mode : 'minimal';
}
