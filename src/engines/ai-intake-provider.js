import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_INTAKE_SCHEMA } from './intake-schema.js';
import { estimateAiCostUsd, estimateTokensFromChars } from './usage-budget.js';
import { parseProviderJson, clip, unwrapClaudeEnvelope } from '../core/json-utils.js';
import { PROMPT_HARD_LIMIT } from '../core/prompt-budget.js';
import { buildExecutorEnv } from './executor-auth.js';
import { spawnSyncPortable, normalizeWindowsCommand } from '../core/spawn-portable.js';

export function resolveIntakeProviderConfig(config = {}, route = null) {
  const ai = config.ai_intake || {};
  const env = process.env;
  const provider = route?.provider || env.ACF_AI_INTAKE_PROVIDER || ai.provider || 'claude-code';
  const mode = env.ACF_AI_INTAKE_MODE || ai.mode || 'hybrid';
  const model = env.ACF_AI_INTAKE_MODEL || ai.model || env.OPENAI_MODEL || 'gpt-4.1';
  const apiKeyEnv = ai.api_key_env || 'OPENAI_API_KEY';
  const apiKey = env[apiKeyEnv] || env.OPENAI_API_KEY || ai.api_key || null;
  const fallbackChain = route?.fallback_chain || parseChain(env.ACF_AI_INTAKE_FALLBACK_CHAIN || ai.fallback_chain || `${provider},openai,heuristic`);
  return {
    enabled: ai.enabled !== false && mode !== 'heuristic' && mode !== 'off' && mode !== 'disabled',
    mode,
    provider,
    fallback_chain: unique([...fallbackChain, 'heuristic']),
    model,
    api_key_env: apiKeyEnv,
    api_key_present: Boolean(apiKey),
    api_key: apiKey,
    base_url: env.ACF_OPENAI_BASE_URL || ai.base_url || 'https://api.openai.com/v1/responses',
    timeout_ms: Number(env.ACF_AI_INTAKE_TIMEOUT_MS || ai.timeout_ms || 60000),
    temperature: ai.temperature ?? 0.2,
    confidence_threshold: Number(env.ACF_AI_INTAKE_CONFIDENCE_THRESHOLD || ai.confidence_threshold || 0.55),
    fallback_on_error: ai.fallback_on_error !== false,
    max_prompt_chars: Number(route?.max_prompt_chars || ai.max_prompt_chars || 24000),
    pricing_usd_per_1m: ai.pricing_usd_per_1m || {},
    claude_code: resolveClaudeCodeConfig(config, route)
  };
}

export async function runIntakeProvider(prompt, config = {}, options = {}) {
  const providerConfig = resolveIntakeProviderConfig(config, options.route || null);
  // Absolute backstop: no matter how max_prompt_chars is configured, never hand
  // a runaway prompt to a CLI. This is the last line of defense against the
  // "prompt too long" failures that break Codex/Claude.
  prompt = clip(prompt, Math.min(providerConfig.max_prompt_chars || PROMPT_HARD_LIMIT, PROMPT_HARD_LIMIT));
  if (options.mockDecision) {
    return { provider: 'mock', model: 'mock', raw: options.mockDecision, parsed: options.mockDecision, used_mock: true, provider_trace: [{ provider: 'mock', status: 'success', schema_parse: 'mock' }] };
  }
  if (!providerConfig.enabled) throw new Error(`AI intake provider disabled by mode=${providerConfig.mode}.`);
  const chain = options.providerChain || providerConfig.fallback_chain;
  const attempts = [];
  for (const provider of chain) {
    if (provider === 'heuristic') break;
    try {
      const result = await runSingleProvider(provider, prompt, providerConfig, config, options);
      result.provider_trace = [...attempts, { provider, status: 'success', model: result.model, duration_ms: result.duration_ms || null, repair_used: Boolean(result.repair_used), extracted_json: Boolean(result.extracted_json) }];
      return result;
    } catch (error) {
      attempts.push({ provider, status: 'failed', error: error.message || String(error) });
    }
  }
  const last = attempts[attempts.length - 1];
  const detail = attempts.map((a) => `${a.provider}: ${a.error || a.status}`).join(' | ');
  const err = new Error(`All external Brain providers failed${detail ? ` (${detail})` : ''}.`);
  err.provider_trace = attempts;
  err.last_provider = last?.provider;
  throw err;
}

export function brainDoctor(config = {}, env = process.env) {
  const providerConfig = resolveIntakeProviderConfig(config);
  const claude = checkCommand(providerConfig.claude_code.command, ['--version'], env);
  const openai = {
    provider: 'openai',
    api_key_env: providerConfig.api_key_env,
    api_key_present: providerConfig.api_key_present,
    available: providerConfig.api_key_present
  };
  const chain = providerConfig.fallback_chain;
  return {
    configured_provider: providerConfig.provider,
    mode: providerConfig.mode,
    fallback_chain: chain,
    claude_code: {
      provider: 'claude-code',
      command: providerConfig.claude_code.command,
      args: providerConfig.claude_code.args,
      prompt_mode: providerConfig.claude_code.prompt_mode,
      sanitize_api_env: providerConfig.claude_code.sanitize_api_env,
      command_found: claude.ok,
      version_output: claude.stdout || claude.stderr || '',
      error: claude.ok ? null : claude.error
    },
    openai,
    heuristic: { provider: 'heuristic', available: true },
    ready: chain.includes('claude-code') ? claude.ok : (providerConfig.provider === 'openai' ? openai.available : true),
    note: 'brain-doctor checks local commands/config only; the first real ask still validates JSON/schema and falls back if needed.'
  };
}

async function runSingleProvider(provider, prompt, providerConfig, config, options) {
  if (provider === 'openai') {
    if (!providerConfig.api_key_present) throw new Error(`Missing ${providerConfig.api_key_env}. Create a .env file or set the environment variable.`);
    return runOpenAIResponses(prompt, providerConfig, options.jsonSchema || AI_INTAKE_SCHEMA, options.schemaName || 'acf_intake_decision', options.systemPrompt);
  }
  if (provider === 'claude-code') return runClaudeCode(prompt, providerConfig, config, options);
  throw new Error(`Unsupported AI intake provider: ${provider}`);
}

// Generic brain call for any task (feature proposals, weakness detection, ...),
// not just intake. Reuses the same fallback chain, safe stdin/file transport,
// prompt-budget discipline and resilient JSON parsing. Returns { parsed,
// provider, ... } or throws an aggregated error with a provider trace.
export async function callBrainJson(prompt, config = {}, options = {}) {
  const providerConfig = resolveIntakeProviderConfig(config, options.route || null);
  prompt = clip(prompt, Math.min(providerConfig.max_prompt_chars || PROMPT_HARD_LIMIT, PROMPT_HARD_LIMIT));
  if (!providerConfig.enabled) throw new Error(`Brain disabled by mode=${providerConfig.mode}.`);
  const chain = options.providerChain || providerConfig.fallback_chain;
  const attempts = [];
  for (const provider of chain) {
    if (provider === 'heuristic') break;
    try {
      const result = await runSingleProvider(provider, prompt, providerConfig, config, options);
      result.provider_trace = [...attempts, { provider, status: 'success', model: result.model }];
      return result;
    } catch (error) {
      attempts.push({ provider, status: 'failed', error: error.message || String(error) });
    }
  }
  const detail = attempts.map((a) => `${a.provider}: ${a.error || a.status}`).join(' | ');
  const err = new Error(`Brain providers failed${detail ? ` (${detail})` : ''}.`);
  err.provider_trace = attempts;
  throw err;
}

function resolveClaudeCodeConfig(config = {}, route = null) {
  const env = process.env;
  const cfg = config.ai_intake?.claude_code || config.claude_code || {};
  return {
    command: normalizeWindowsCommand(env.ACF_CLAUDE_CODE_COMMAND || cfg.command || 'claude'),
    args: parseArgs(env.ACF_CLAUDE_CODE_ARGS || cfg.args || '-p'),
    prompt_mode: env.ACF_CLAUDE_CODE_PROMPT_MODE || cfg.prompt_mode || 'stdin',
    arg_prompt_max_chars: Number(env.ACF_CLAUDE_CODE_ARG_PROMPT_MAX_CHARS || cfg.arg_prompt_max_chars || 1800),
    timeout_ms: Number(env.ACF_CLAUDE_CODE_TIMEOUT_MS || cfg.timeout_ms || (route?.depth === 'architect' ? 120000 : 90000)),
    max_retries: Number(env.ACF_CLAUDE_CODE_MAX_RETRIES || cfg.max_retries || 1),
    require_json: env.ACF_CLAUDE_CODE_REQUIRE_JSON ? env.ACF_CLAUDE_CODE_REQUIRE_JSON !== 'false' : cfg.require_json !== false,
    sanitize_api_env: env.ACF_CLAUDE_CODE_SANITIZE_API_ENV ? env.ACF_CLAUDE_CODE_SANITIZE_API_ENV !== 'false' : cfg.sanitize_api_env !== false,
    // v5.0: deterministic transport. `claude -p --output-format json` returns a
    // guaranteed-JSON envelope instead of free text. Enabled by default.
    output_format: env.ACF_CLAUDE_CODE_OUTPUT_FORMAT || cfg.output_format || 'json',
    // v5.0: model cascade. The route can pin a model per depth tier; falls back
    // to whatever the CLI has configured when empty.
    model: route?.model || env.ACF_CLAUDE_CODE_MODEL || cfg.model || null,
    // v5.0: one semantic retry with a hard JSON contract before giving up.
    strict_retry: env.ACF_CLAUDE_CODE_STRICT_RETRY ? env.ACF_CLAUDE_CODE_STRICT_RETRY !== 'false' : cfg.strict_retry !== false
  };
}

function runClaudeCode(prompt, providerConfig, config, options = {}) {
  const started = Date.now();
  const cc = providerConfig.claude_code;
  const { env } = cc.sanitize_api_env ? buildExecutorEnv(config, process.env) : { env: process.env };
  const attempts = [];
  const maxPrompt = providerConfig.max_prompt_chars;
  const clippedPrompt = clip(prompt, maxPrompt);
  const traceDir = options.traceDir || null;
  let attemptNo = 0;

  const runOnce = (promptText, phase) => {
    const modes = transportModesFor(cc, promptText);
    let lastError = null;
    for (const mode of modes) {
      attemptNo += 1;
      const transport = buildClaudeTransport(mode, cc, promptText);
      const result = spawnSyncPortable(cc.command, transport.args, {
        input: transport.input,
        encoding: 'utf8',
        shell: false,
        timeout: cc.timeout_ms,
        maxBuffer: 10 * 1024 * 1024,
        env
      });
      if (transport.cleanup) transport.cleanup();
      const stdout = String(result.stdout || '').trim();
      const stderr = String(result.stderr || '').trim();
      persistRawAttempt(traceDir, attemptNo, phase, mode, transport.args, stdout, stderr, result);
      attempts.push({ attempt: attemptNo, phase, mode, transport: transport.transport, prompt_chars: promptText.length, status: result.status, signal: result.signal, stderr: stderr.slice(0, 1000) });
      if (result.error) { lastError = result.error; continue; }
      if (result.status !== 0) {
        lastError = new Error(`Claude Code exited ${result.status}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`);
        // Do not retry by putting a large prompt into argv. That is exactly what breaks Windows.
        continue;
      }
      if (!stdout) { lastError = new Error('Claude Code returned empty stdout.'); continue; }
      try {
        // Layer 1: deterministic envelope from --output-format json (if present).
        const envelope = unwrapClaudeEnvelope(stdout);
        // Layer 2: schema JSON extraction from the model text (fences, repairs).
        const parsed = parseProviderJson(envelope.text);
        return { parsed, stdout, envelope };
      } catch (error) {
        lastError = error;
        attempts[attempts.length - 1].parse_error = String(error.message || error).slice(0, 300);
      }
    }
    const err = new Error(lastError?.message || 'unknown error');
    err.transport_exhausted = true;
    throw err;
  };

  let outcome = null;
  let repairUsed = false;
  let firstError = null;
  try {
    outcome = runOnce(clippedPrompt, 'initial');
  } catch (error) {
    firstError = error;
    // Semantic retry: transports won't fix non-JSON content. One strict re-ask
    // with a hard contract usually will. Skip when the process itself failed.
    const parseFailure = attempts.some((a) => a.status === 0 && a.parse_error);
    if (cc.strict_retry && parseFailure) {
      const strictPrompt = `${clippedPrompt}\n\nCRITICAL OUTPUT CONTRACT: Your previous reply was not valid JSON. Respond again with ONLY a single JSON object matching the requested schema. No prose, no markdown fences, no explanations, no preamble. Start your reply with { and end it with }.`;
      try {
        outcome = runOnce(clip(strictPrompt, maxPrompt), 'strict-retry');
        repairUsed = true;
      } catch (retryError) {
        firstError = retryError;
      }
    }
  }
  if (!outcome) {
    const err = new Error(`Claude Code Brain failed: ${firstError?.message || 'unknown error'}`);
    err.attempts = attempts;
    if (traceDir) err.trace_dir = traceDir;
    throw err;
  }
  const { parsed, stdout, envelope } = outcome;
  return {
    provider: 'claude-code',
    model: cc.model || 'claude-code-cli',
    raw: stdout,
    parsed: parsed.parsed,
    output_text: parsed.text,
    extracted_json: parsed.extracted,
    envelope_used: Boolean(envelope?.unwrapped),
    repair_used: repairUsed || Boolean(parsed.repaired),
    duration_ms: Date.now() - started,
    attempts,
    usage: {
      // Claude Code envelope splits cached input: input_tokens only counts the
      // non-cached slice ("2 in / 2951 out" looks broken without the sum).
      input_tokens: envelope?.envelope?.usage
        ? Number(envelope.envelope.usage.input_tokens || 0) + Number(envelope.envelope.usage.cache_creation_input_tokens || 0) + Number(envelope.envelope.usage.cache_read_input_tokens || 0)
        : estimateTokensFromChars(clippedPrompt),
      output_tokens: envelope?.envelope?.usage?.output_tokens ?? estimateTokensFromChars(parsed.text),
      estimated_cost_usd: envelope?.envelope?.total_cost_usd ?? 0
    }
  };
}

// Every attempt leaves a complete artifact on disk. Debugging a degraded brain
// should be reading a file, not archaeology.
function persistRawAttempt(traceDir, n, phase, mode, args, stdout, stderr, result) {
  if (!traceDir) return;
  try {
    fs.mkdirSync(traceDir, { recursive: true });
    const base = path.join(traceDir, `attempt-${String(n).padStart(2, '0')}-${phase}-${mode}`);
    fs.writeFileSync(`${base}.stdout.txt`, stdout || '', 'utf8');
    if (stderr) fs.writeFileSync(`${base}.stderr.txt`, stderr, 'utf8');
    fs.writeFileSync(`${base}.meta.json`, JSON.stringify({ phase, mode, args, status: result.status, signal: result.signal, error: result.error ? String(result.error.message || result.error) : null, at: new Date().toISOString() }, null, 2), 'utf8');
  } catch { /* tracing must never break the call */ }
}

function transportModesFor(cc, prompt) {
  if (cc.prompt_mode === 'arg') {
    if (prompt.length <= cc.arg_prompt_max_chars) return ['arg'];
    return ['stdin', 'file-stdin'];
  }
  if (cc.prompt_mode === 'file') return ['file-stdin', 'stdin'];
  // Default: stdin first, file-backed stdin second. Never fallback to arg for long prompts.
  if (prompt.length > cc.arg_prompt_max_chars) return ['stdin', 'file-stdin'];
  return ['stdin', 'arg'];
}

function effectiveClaudeArgs(cc) {
  const args = [...cc.args];
  if (cc.output_format && cc.output_format !== 'text' && !args.includes('--output-format')) {
    args.push('--output-format', cc.output_format);
  }
  if (cc.model && !args.includes('--model')) args.push('--model', cc.model);
  return args;
}

function buildClaudeTransport(mode, cc, prompt) {
  if (mode === 'arg') return { transport: 'arg', args: [...effectiveClaudeArgs(cc), prompt], input: undefined, cleanup: null };
  if (mode === 'file-stdin') {
    const file = path.join(os.tmpdir(), `acf-claude-brain-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(file, prompt, 'utf8');
    const input = fs.readFileSync(file, 'utf8');
    return { transport: 'file-stdin', args: effectiveClaudeArgs(cc), input, cleanup: () => { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } } };
  }
  return { transport: 'stdin', args: effectiveClaudeArgs(cc), input: prompt, cleanup: null };
}

async function runOpenAIResponses(prompt, providerConfig, jsonSchema = AI_INTAKE_SCHEMA, schemaName = 'acf_intake_decision', systemPrompt = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerConfig.timeout_ms);
  try {
    const payload = {
      model: providerConfig.model,
      input: [
        {
          role: 'system',
          content: systemPrompt || 'You are the Orchestrator Brain of AI Code Factory. Return only the structured decision requested by the schema. Make orchestration decisions; never claim code was executed. Do not expose private chain-of-thought; include concise decision reasons only.'
        },
        { role: 'user', content: clip(prompt, providerConfig.max_prompt_chars) }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict: true,
          schema: jsonSchema
        }
      }
    };
    if (providerConfig.temperature !== null && providerConfig.temperature !== undefined) payload.temperature = providerConfig.temperature;
    const response = await fetch(providerConfig.base_url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerConfig.api_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`OpenAI intake request failed (${response.status}): ${bodyText.slice(0, 1000)}`);
    const body = JSON.parse(bodyText);
    const outputText = extractResponseText(body);
    if (!outputText) throw new Error('OpenAI response did not contain output text.');
    const parsedResult = parseProviderJson(outputText);
    const inputTokens = Number(body.usage?.input_tokens || body.usage?.prompt_tokens || estimateTokensFromChars(prompt));
    const outputTokens = Number(body.usage?.output_tokens || body.usage?.completion_tokens || estimateTokensFromChars(outputText));
    const estimatedCostUsd = estimateAiCostUsd({ ai_intake: { pricing_usd_per_1m: providerConfig.pricing_usd_per_1m } }, providerConfig.model, inputTokens, outputTokens);
    return { provider: 'openai', model: providerConfig.model, raw: body, parsed: parsedResult.parsed, output_text: parsedResult.text, extracted_json: parsedResult.extracted, usage: { input_tokens: inputTokens, output_tokens: outputTokens, estimated_cost_usd: estimatedCostUsd } };
  } finally {
    clearTimeout(timeout);
  }
}

function extractResponseText(body) {
  if (typeof body.output_text === 'string') return body.output_text;
  const chunks = [];
  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') chunks.push(content.text);
      if (typeof content.output_text === 'string') chunks.push(content.output_text);
    }
  }
  return chunks.join('\n').trim();
}

function checkCommand(command, args, env) {
  try {
    const result = spawnSyncPortable(normalizeWindowsCommand(command), args, { encoding: 'utf8', shell: false, timeout: 10000, env });
    return { ok: !result.error && result.status === 0, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim(), error: result.error?.message || (result.status !== 0 ? `exit ${result.status}` : null) };
  } catch (error) {
    return { ok: false, stdout: '', stderr: '', error: error.message || String(error) };
  }
}

function parseArgs(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/\s+/).map((x) => x.trim()).filter(Boolean);
}

function parseChain(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
