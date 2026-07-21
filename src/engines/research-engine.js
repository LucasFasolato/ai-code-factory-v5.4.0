import { aiPath } from '../core/paths.js';
import { ensureDir, writeJson, writeText, readJsonSafe } from '../core/fs.js';
import { nowIso } from '../core/format.js';

export async function runWebResearch(root, query, config = {}, options = {}) {
  if (!query) throw new Error('query is required');
  const provider = config.research?.default_provider || 'duckduckgo-html';
  const maxResults = Number(config.research?.max_results || 5);
  const started = nowIso();
  let results = [];
  let status = 'failed';
  let error = null;
  try {
    if (provider === 'duckduckgo-html') results = await searchDuckDuckGo(query, maxResults, Number(config.research?.timeout_ms || 15000));
    status = 'ok';
  } catch (err) {
    error = err.message || String(err);
    status = 'failed';
  }
  const stamp = safeStamp(query);
  const jsonFile = aiPath(root, 'research', `${stamp}.json`);
  const mdFile = aiPath(root, 'research', `${stamp}.md`);
  const payload = { query, provider, status, error, generated_at: started, results };
  ensureDir(aiPath(root, 'research'));
  writeJson(jsonFile, payload);
  writeText(mdFile, renderResearchMarkdown(payload));
  const indexFile = aiPath(root, 'research', 'index.json');
  const index = readJsonSafe(indexFile, []);
  index.push({ query, provider, status, generated_at: started, json: `.ai/research/${stamp}.json`, md: `.ai/research/${stamp}.md` });
  writeJson(indexFile, index.slice(-200));
  return { ...payload, json_file: jsonFile, md_file: mdFile };
}

async function searchDuckDuckGo(query, maxResults, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'AI-Code-Factory/3.6' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return parseDuckHtml(html).slice(0, maxResults);
  } finally {
    clearTimeout(timeout);
  }
}

function parseDuckHtml(html) {
  const out = [];
  const regex = /<a[^>]*class="[^\"]*result__a[^\"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gims;
  let m;
  while ((m = regex.exec(html))) {
    out.push({ title: stripTags(m[2]).trim(), url: decodeHtml(m[1]), snippet: '' });
  }
  const snippetRegex = /<a[^>]*class="[^\"]*result__snippet[^\"]*"[^>]*>(.*?)<\/a>|<div[^>]*class="[^\"]*result__snippet[^\"]*"[^>]*>(.*?)<\/div>/gims;
  let i = 0;
  while ((m = snippetRegex.exec(html)) && i < out.length) {
    out[i].snippet = stripTags(m[1] || m[2] || '').trim();
    i += 1;
  }
  return out.filter((item) => item.title && item.url);
}

function renderResearchMarkdown(payload) {
  return [
    `# Web Research — ${payload.query}`,
    '',
    `Provider: ${payload.provider}`,
    `Status: ${payload.status}`,
    payload.error ? `Error: ${payload.error}` : '',
    '',
    '## Results',
    '',
    ...(payload.results || []).map((item, i) => `${i + 1}. [${item.title}](${item.url})${item.snippet ? `\n   - ${item.snippet}` : ''}`)
  ].filter(Boolean).join('\n');
}

function stripTags(value) { return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }
function decodeHtml(value) { return String(value || '').replace(/&amp;/g, '&'); }
function safeStamp(query) { return query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'research'; }

export async function runDesignResearch(root, requestId, intake = {}, config = {}) {
  const ask = intake.raw_user_ask || intake.interpreted_intent || 'landing page design';
  const base = extractDomainTerms(ask);
  const queries = [
    `${base} best landing page design inspiration`,
    `${base} premium website UI UX inspiration`,
    `${base} modern web interactions animation examples`,
    `${base} before after slider web design inspiration`
  ];
  const results = [];
  for (const query of queries) {
    // Keep failures contained. Design generation should not be blocked by web/network issues.
    const result = await runWebResearch(root, query, config);
    results.push({ query, status: result.status, error: result.error, results: (result.results || []).slice(0, 4), md_file: result.md_file, json_file: result.json_file });
  }
  const payload = {
    request_id: requestId,
    generated_at: nowIso(),
    source: 'design-research',
    queries,
    results,
    distilled_patterns: distillDesignPatterns(results)
  };
  const file = aiPath(root, 'research', `${requestId}-design-research.json`);
  const mdFile = aiPath(root, 'research', `${requestId}-design-research.md`);
  writeJson(file, payload);
  writeText(mdFile, renderDesignResearchMarkdown(payload));
  return { ...payload, json_file: file, md_file: mdFile };
}

function extractDomainTerms(ask) {
  const s = String(ask || '').toLowerCase();
  if (/real estate|propiedad|inmueble|reforma|interiorismo|renovaci/.test(s)) return 'real estate renovation interior design';
  if (/marketplace|ecommerce|e-commerce|tienda|shop/.test(s)) return 'marketplace ecommerce';
  if (/dashboard|admin|saas/.test(s)) return 'saas dashboard';
  return 'premium landing page';
}

function distillDesignPatterns(results) {
  const joined = JSON.stringify(results).toLowerCase();
  const patterns = [
    'Use a strong editorial hero with a clear conversion path above the fold.',
    'Use premium typography and disciplined whitespace; avoid generic card soup.',
    'Use real visual storytelling: transformation, proof, process, and trust cues.',
    'Use subtle motion and interaction affordances; do not animate everything.',
    'Use mobile-first CTA patterns and a clear information hierarchy.'
  ];
  if (/before|after|comparison|slider/.test(joined)) patterns.push('Make before/after comparison the main engagement moment with a real draggable control.');
  if (/interior|architecture|renovation|real estate/.test(joined)) patterns.push('Use warm neutral materials, architectural photography language, and texture/detail shots.');
  return patterns;
}

function renderDesignResearchMarkdown(payload) {
  return [
    `# Design Research — ${payload.request_id}`,
    '',
    `Generated at: ${payload.generated_at}`,
    '',
    '## Distilled design patterns',
    '',
    ...(payload.distilled_patterns || []).map((p) => `- ${p}`),
    '',
    '## Queries',
    '',
    ...(payload.results || []).map((entry, i) => [
      `### ${i + 1}. ${entry.query}`,
      '',
      `Status: ${entry.status}`,
      entry.error ? `Error: ${entry.error}` : '',
      '',
      ...((entry.results || []).map((item, j) => `${j + 1}. [${item.title}](${item.url})${item.snippet ? ` — ${item.snippet}` : ''}`))
    ].filter(Boolean).join('\n'))
  ].join('\n');
}
