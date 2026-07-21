// Centralized prompt-size discipline. Oversized prompts are the #1 cause of
// Codex/Claude CLI failures: most shells cap a single command-line argument
// (Windows ~32 KB total), and even stdin-fed models choke or get slow on
// runaway context. Every path that builds a prompt or contract for an external
// tool must run it through here so a giant context can never reach the CLI.

// Conservative ceiling for a single argv string on Windows (the tightest OS).
export const ARGV_SAFE_LIMIT = 7000;
// Hard ceiling for any prompt we will ever hand to a CLI, regardless of transport.
export const PROMPT_HARD_LIMIT = 60000;

export function promptSizeReport(text) {
  const chars = String(text || '').length;
  return {
    chars,
    fits_argv: chars <= ARGV_SAFE_LIMIT,
    over_hard_limit: chars > PROMPT_HARD_LIMIT
  };
}

// Truncate to a budget, cutting on a paragraph/line boundary when possible so we
// never slice a word or JSON token in half, and always annotate the cut.
export function budgetText(text, maxChars) {
  const s = String(text ?? '');
  const max = Number(maxChars);
  if (!Number.isFinite(max) || max <= 0 || s.length <= max) return s;
  // Reserve room for the annotation so the returned string never exceeds `max`.
  const annotationReserve = 160;
  const body = Math.max(0, max - annotationReserve);
  const slice = s.slice(0, body);
  const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
  const cut = lastBreak > body * 0.6 ? slice.slice(0, lastBreak) : slice;
  const omitted = s.length - cut.length;
  return `${cut}\n\n[...truncated ${omitted} chars to respect the prompt budget. Full content is on disk; read the referenced file for detail...]`;
}

// Decide how to hand a prompt to a CLI without ever overflowing argv.
// Returns the transport plan; the caller writes the file / pipes stdin.
export function planPromptTransport(prompt, { preferred = 'stdin', argvLimit = ARGV_SAFE_LIMIT } = {}) {
  const chars = String(prompt || '').length;
  if (preferred === 'arg' && chars <= argvLimit) return { transport: 'arg', reason: 'small enough for argv' };
  if (chars > argvLimit) return { transport: 'file-stdin', reason: `prompt ${chars} chars exceeds argv-safe ${argvLimit}` };
  return { transport: 'stdin', reason: 'default stdin transport' };
}
