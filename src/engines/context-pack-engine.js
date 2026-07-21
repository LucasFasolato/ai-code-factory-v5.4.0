import { exists, readJson, readJsonSafe, readText, writeText } from '../core/fs.js';
import { aiPath, requestPaths } from '../core/paths.js';
import { bullet } from '../core/format.js';
import { listConstraints } from './constraint-engine.js';
import { readRepoMapMd } from './repo-map-engine.js';
import { playbookContextBlock } from './playbook-engine.js';
import { readProgress } from './progress-engine.js';

export function buildContextPack(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const req = readJsonSafe(paths.backlog, null) || {};
  const spec = readText(paths.spec, 'Spec not generated yet.');
  const answers = readText(paths.answersMd, 'No user answers recorded yet.');
  const approvedDesign = exists(paths.approvedDesign) ? readJsonSafe(paths.approvedDesign, null) : null;
  const gates = exists(paths.gates) ? readJsonSafe(paths.gates, null) : null;
  const toolRouting = exists(paths.toolRouting) ? readJsonSafe(paths.toolRouting, null) : null;
  const projectDna = readJsonSafe(aiPath(root, 'project-dna.json'), null);
  const preferences = readJsonSafe(aiPath(root, 'knowledge', 'user-preferences.json'), null);
  const compiledKnowledge = readText(aiPath(root, 'knowledge', 'compiled-knowledge.md'), 'No compiled knowledge yet. Run compile-memory to consolidate history.');
  const designTaste = readText(aiPath(root, 'knowledge', 'design-taste.md'), 'No design taste file.');
  const engineeringTaste = readText(aiPath(root, 'knowledge', 'engineering-taste.md'), 'No engineering taste file.');
  const lockedConstraints = listConstraints(root);
  const brainSummary = readText(paths.brainSummary, 'No brain summary artifact yet.');
  const brainDecisionLog = readText(paths.brainDecisionLog, 'No brain decision log artifact yet.');
  // v5.0: purpose-built context beats send-everything. The repo map is a
  // signature skeleton (~90% cheaper than raw files); a matched playbook is a
  // proven plan that replaces exploration.
  const repoMap = readRepoMapMd(root, 5000);
  const playbook = playbookContextBlock(root, intake.raw_user_ask || intake.interpreted_intent || '');
  // v5.2: a resuming executor must know what is already done (Anthropic's
  // long-running-agent pattern). Timeout + retry without this = redo everything.
  const progress = readProgress(root, requestId, 2500);

  const md = `# Context Pack — ${requestId}\n\n` +
    `## User Intent\n\n${intake.interpreted_intent}\n\n` +
    `## Orchestrator Brain\n\n${clip(brainSummary, 3000)}\n\n` +
    `## Brain Decisions\n\n${clip(brainDecisionLog, 4000)}\n\n` +
    `## Status\n\n- Current status: ${req.status || 'unknown'}\n- Work type: ${intake.work_type}\n- Difficulty: ${intake.difficulty || 'unknown'}\n- Scope: ${intake.scope || 'unknown'}\n- Project type: ${intake.project_type}\n- Workflow: ${intake.recommended_workflow}\n- Brain depth: ${intake.brain_depth || intake.brain?.route?.depth || 'n/a'}\n- Reasoning strategy: ${intake.reasoning_strategy || intake.brain?.route?.reasoning_strategy || 'n/a'}\n- Brain provider route: ${(intake.brain?.route?.fallback_chain || [intake.brain?.provider || 'heuristic']).join(' → ')}\n- External Brain used: ${intake.brain?.route?.use_external_brain ? 'yes' : 'no'}\n- Risk: ${intake.risk}\n- Confidence: ${intake.confidence}\n- Should implement now: ${intake.should_implement_now ? 'yes' : 'no'}\n- Requires decomposition: ${intake.requires_decomposition ? 'yes' : 'no'}\n\n` +
    `## User Answers / Clarifications\n\n${clip(answers, 5000)}\n\n` +
    `## Improved Spec Summary\n\n${summarizeSpec(spec)}\n\n` +
    `## Suggested Roadmap / REQ Slices\n\n${suggestedReqs(intake)}\n\n` +
    `## Project DNA\n\n${clipJson(projectDna, 4000)}\n\n` +
    (repoMap ? `## Repo Map (signature skeleton — prefer this over reading whole files)\n\n${repoMap}\n\n` : '') +
    (playbook ? `${playbook}\n\n` : '') +
    (progress ? `## Progress so far (DO NOT redo completed stages)\n\n${progress}\n\n` : '') +
    `## Learned User Rules\n\n${learnedRules(preferences)}\n\n` +
    `## Compiled Knowledge\n\n${clip(compiledKnowledge, 5000)}\n\n` +
    `## Design Taste\n\n${clip(designTaste, 2500)}\n\n` +
    `## Engineering Taste\n\n${clip(engineeringTaste, 2500)}\n\n` +
    `## Locked Constraints\n\n${lockedConstraints.length ? bullet(lockedConstraints.map((c) => `[${c.id}] ${c.text}${c.pattern ? ` | pattern: ${c.pattern}` : ''}`)) : '- none'}\n\n` +
    `## Approved Design\n\n${approvedDesign ? approvedDesignSummary(approvedDesign) : 'No approved design yet.'}\n\n` +
    `## Must Not Do\n\n${bullet(intake.must_not_do)}\n\n` +
    `## Allowed Assumptions\n\n${bullet(intake.assumptions_allowed)}\n\n` +
    `## Missing Info\n\n${bullet(intake.missing_info)}\n\n` +
    `## Allowed Files Strategy\n\n${intake.allowed_files_strategy || 'files directly related to the request only'}\n\n` +
    `## Files Likely Needed\n\n${filesLikelyNeeded(intake).map((f) => `- ${f}`).join('\n')}\n\n` +
    `## Tool Routing\n\n${toolRouting ? bullet(toolRouting.recommended_tools.map((t) => `${t.tool}: ${t.reason}`)) : '- not generated'}\n\n` +
    `## Gates Summary\n\n${gates ? gateSummary(gates) : 'Gates not generated yet.'}\n\n` +
    `## Validation\n\n- npm run lint\n- npm run typecheck\n- npm test\n- npm run build\n` +
    `${intake.work_type === 'frontend_visual' ? '- visual review\n- visual acceptance\n- fake data scanner\n' : '- fake data scanner when relevant\n'}\n` +
    `## Token Budget Rules\n\n- Prefer this context pack over full history.\n- Do not include huge logs unless needed.\n- Do not scan/write unrelated files.\n- Do not send the whole repo to executors.\n`;

  return { request_id: requestId, markdown: enforceBudget(md, root) };
}

export function saveContextPack(root, requestId) {
  const result = buildContextPack(root, requestId);
  writeText(requestPaths(root, requestId).contextPack, result.markdown);
  return result;
}

function summarizeSpec(spec) {
  const lines = spec.split('\n').filter(Boolean);
  return lines.slice(0, 50).join('\n');
}

function approvedDesignSummary(design) {
  return [
    `- Approved design: ${design.approved_design}`,
    `- Provider: ${design.provider || 'unknown'}`,
    `- Desktop: ${design.desktop_image || 'missing'}`,
    `- Mobile: ${design.mobile_image || 'missing'}`,
    `- Notes: ${design.notes || 'none'}`
  ].join('\n');
}

function filesLikelyNeeded(intake) {
  if (Array.isArray(intake.allowed_files) && intake.allowed_files.length) return intake.allowed_files;
  if (intake.work_type === 'frontend_visual') return ['src/app/page.tsx', 'src/app/globals.css', 'src/app/layout.tsx', 'src/components/**', 'tests/**', 'public/**'];
  if (intake.work_type === 'backend_api') return ['src/**/*.controller.ts', 'src/**/*.service.ts', 'src/**/*.dto.ts', 'src/**/*.spec.ts', 'test/**/*.ts', 'tests/**/*.ts'];
  if (intake.work_type === 'fullstack_feature') return ['apps/web/**', 'apps/api/**', 'packages/**', 'tests/**'];
  if (intake.work_type === 'product_epic') return ['.ai/epics/**', '.ai/reasoning/**', '.ai/backlog/**'];
  return ['files relevant to the request only'];
}

function gateSummary(gates) {
  if (!gates?.gates) return 'No gate details.';
  return Object.entries(gates.gates).map(([name, gate]) => `- ${name}: ${gate.status} — ${gate.reason}`).join('\n');
}

function suggestedReqs(intake) {
  const reqs = intake.suggested_reqs || [];
  if (!reqs.length) return '- none';
  return reqs.map((r, i) => `${i + 1}. **${r.title}** (${r.risk || 'medium'})\n   - Why: ${r.reason || 'not specified'}\n   - Depends on: ${(r.depends_on || []).length ? r.depends_on.join(', ') : 'none'}`).join('\n');
}

function learnedRules(preferences) {
  const rules = preferences?.learned_rules || [];
  return rules.length ? bullet(rules.map((r) => typeof r === 'string' ? r : r.rule)) : '- none';
}

function clipJson(value, max) {
  return clip(value ? JSON.stringify(value, null, 2) : 'Not configured.', max);
}

function clip(text, max) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[TRUNCATED]`;
}

function enforceBudget(md, root) {
  const config = readJsonSafe(aiPath(root, 'config.json'), {});
  const max = config?.token_budget?.max_context_pack_chars || 30000;
  if (md.length <= max) return md;
  return `${md.slice(0, max)}\n\n[CONTEXT PACK TRUNCATED TO ${max} CHARS]`;
}
