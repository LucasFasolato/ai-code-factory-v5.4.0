export function stripMarkdownFences(text) {
  return String(text || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

export function extractFirstJsonObject(text) {
  const raw = stripMarkdownFences(text);
  if (!raw) throw new Error('Empty provider output.');
  try { return { text: raw, parsed: JSON.parse(raw), extracted: false }; } catch { /* continue */ }

  const start = raw.indexOf('{');
  if (start < 0) throw new Error('No JSON object start found in provider output.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        return { text: candidate, parsed: JSON.parse(candidate), extracted: true };
      }
    }
  }
  throw new Error('JSON object was started but not closed.');
}

// Claude Code CLI with `--output-format json` wraps the model text in a
// deterministic envelope: { type: "result", result: "...", is_error, ... }.
// Unwrapping it first removes the parsing lottery: the envelope is guaranteed
// JSON, and only its `result` field needs schema-level extraction.
export function unwrapClaudeEnvelope(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) return { unwrapped: false, text: raw };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.type === 'result' && 'result' in parsed) {
      if (parsed.is_error) {
        const err = new Error(`Claude Code envelope reported an error: ${String(parsed.result).slice(0, 300)}`);
        err.envelope_error = true;
        throw err;
      }
      return { unwrapped: true, text: String(parsed.result ?? ''), envelope: { duration_ms: parsed.duration_ms, num_turns: parsed.num_turns, session_id: parsed.session_id, usage: parsed.usage || null, total_cost_usd: parsed.total_cost_usd ?? null } };
    }
  } catch (error) {
    if (error.envelope_error) throw error;
    // Not a valid envelope; fall through and let the normal parser try.
  }
  return { unwrapped: false, text: raw };
}

export function parseProviderJson(text) {
  try { return extractFirstJsonObject(text); }
  catch (error) {
    const cleaned = stripMarkdownFences(text)
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .trim();
    try { return extractFirstJsonObject(cleaned); }
    catch (innerError) {
      // Last-resort repair for a common LLM quirk: trailing commas before } or ].
      // Only strips commas that are not inside strings, so it can't corrupt data.
      const repaired = stripTrailingCommas(cleaned);
      const result = extractFirstJsonObject(repaired);
      result.repaired = true;
      return result;
    }
  }
}

function stripTrailingCommas(raw) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === ',') {
      // Look ahead past whitespace; drop the comma if the next token closes a container.
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j += 1;
      if (raw[j] === '}' || raw[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

export function clip(text, max) {
  const s = String(text || '');
  if (!Number.isFinite(Number(max)) || Number(max) <= 0 || s.length <= Number(max)) return s;
  return `${s.slice(0, Number(max))}\n\n[TRUNCATED TO ${Number(max)} CHARS]`;
}
