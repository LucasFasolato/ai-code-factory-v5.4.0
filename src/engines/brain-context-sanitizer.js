import { clip } from '../core/json-utils.js';

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_\-]{20,}/g,
  /sk-proj-[A-Za-z0-9_\-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9_\-]{10,}/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?<=password\s*[:=]\s*)[^\s,;]+/gi,
  /(?<=api[_-]?key\s*[:=]\s*)[^\s,;]+/gi,
  /(?<=token\s*[:=]\s*)[^\s,;]+/gi,
  /(?<=secret\s*[:=]\s*)[^\s,;]+/gi
];

const DEPTH_LIMITS = {
  fast: { compiled: 1200, taste: 800, backlog: 4, files: 25, prompt: 10000 },
  standard: { compiled: 3500, taste: 1400, backlog: 8, files: 60, prompt: 18000 },
  deep: { compiled: 6000, taste: 2200, backlog: 12, files: 100, prompt: 28000 },
  architect: { compiled: 9000, taste: 3000, backlog: 16, files: 140, prompt: 42000 }
};

export function sanitizeBrainContext(ctx, route = {}, config = {}) {
  const depth = route.depth || 'standard';
  const limits = { ...(DEPTH_LIMITS[depth] || DEPTH_LIMITS.standard) };
  const configuredMax = Number(config.ai_intake?.max_prompt_chars || 0);
  if (configuredMax > 0) limits.prompt = Math.min(limits.prompt, configuredMax);

  const out = deepSanitize(ctx);
  out.compiled_knowledge = clip(out.compiled_knowledge || '', limits.compiled);
  out.design_taste = clip(out.design_taste || '', limits.taste);
  out.engineering_taste = clip(out.engineering_taste || '', limits.taste);
  out.backlog = Array.isArray(out.backlog) ? out.backlog.slice(-limits.backlog) : [];
  if (out.project_map?.detected_files) out.project_map.detected_files = out.project_map.detected_files.slice(0, limits.files);
  out.brain_context_policy = {
    depth,
    strategy: route.reasoning_strategy || 'deliberate',
    max_prompt_chars: limits.prompt,
    secrets_redacted: true,
    source_files_not_included: true,
    note: 'Brain receives summaries and safe project metadata, not .env contents, secrets, full logs, or complete source files.'
  };
  return { context: out, max_prompt_chars: limits.prompt, limits };
}

export function redactSecrets(text) {
  let s = String(text || '');
  for (const pattern of SECRET_PATTERNS) s = s.replace(pattern, '[REDACTED_SECRET]');
  return s;
}

function deepSanitize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map((v) => deepSanitize(v));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (/\.env$|secret|password|token|api[_-]?key|credential/i.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = deepSanitize(child);
      }
    }
    return out;
  }
  return value;
}
