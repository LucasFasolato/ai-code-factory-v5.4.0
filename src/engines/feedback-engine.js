import { aiPath } from '../core/paths.js';
import { readJson, writeJson, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';

const FEEDBACK_FILE = (root) => aiPath(root, 'feedback', 'feedback-log.json');
const PREFERENCES_FILE = (root) => aiPath(root, 'knowledge', 'user-preferences.json');

export function recordFeedback(root, text, options = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Usage: npm run ai -- feedback "..."');
  const log = readJson(FEEDBACK_FILE(root), []) || [];
  const entry = {
    id: `FB-${String(log.length + 1).padStart(3, '0')}`,
    text: trimmed,
    request_id: options.requestId || null,
    at: nowIso(),
    mined: false
  };
  log.push(entry);
  writeJson(FEEDBACK_FILE(root), log);
  appendEvent(root, 'FEEDBACK_RECORDED', { request_id: entry.request_id, text: trimmed, feedback_id: entry.id });
  return entry;
}

// mine-feedback: converts human corrections into candidate rules.
// Candidate rules go to .ai/improvements/proposals/ and, when clearly safe
// (phrased as a preference), into user-preferences.learned_rules.
export function mineFeedback(root) {
  const log = readJson(FEEDBACK_FILE(root), []) || [];
  const pending = log.filter((f) => !f.mined);
  if (!pending.length) return { mined: 0, rules: [], message: 'No unmined feedback.' };

  const rules = pending.map((f) => ({
    feedback_id: f.id,
    rule: toRule(f.text),
    source_text: f.text,
    kind: classifyFeedback(f.text),
    at: nowIso()
  }));

  // Safe preference-like rules are stored as learned_rules; everything is proposed.
  const preferences = readJson(PREFERENCES_FILE(root), { learned_rules: [] }) || { learned_rules: [] };
  preferences.learned_rules = preferences.learned_rules || [];
  for (const r of rules.filter((r) => r.kind === 'preference')) {
    if (!preferences.learned_rules.some((existing) => (existing.rule || existing) === r.rule)) {
      preferences.learned_rules.push({ rule: r.rule, source: r.feedback_id, at: r.at });
    }
  }
  preferences.updated_at = nowIso();
  writeJson(PREFERENCES_FILE(root), preferences);

  const proposalFile = aiPath(root, 'improvements', 'proposals', `feedback-rules-${Date.now()}.md`);
  writeText(proposalFile, `# Candidate Rules from Feedback\n\nGenerated at: ${nowIso()}\n\n` +
    rules.map((r) => `## ${r.feedback_id} (${r.kind})\n\n- Original: ${r.source_text}\n- Candidate rule: ${r.rule}\n`).join('\n') +
    `\n## Applying\n\nPreference rules were added to user-preferences.json. Process/gate rules require approval: review and apply via playbook-upgrade.\n`);

  for (const f of log) if (pending.includes(f)) f.mined = true;
  writeJson(FEEDBACK_FILE(root), log);
  return { mined: pending.length, rules, proposal: proposalFile };
}

function toRule(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (/^(no|nunca|never|don'?t|do not)\b/i.test(t)) return t.endsWith('.') ? t : `${t}.`;
  return `Prefer: ${t}${t.endsWith('.') ? '' : '.'}`;
}

function classifyFeedback(text) {
  if (/gate|bloque|close|cerrar|aprobaci|approval|valid/i.test(text)) return 'gate-or-process';
  if (/dise[ñn]|visual|color|tipograf|layout|hero|cta/i.test(text)) return 'preference';
  if (/comando|cli|interfaz|simple|dashboard/i.test(text)) return 'preference';
  if (/nunca|never|no inventar|do not invent|prohib/i.test(text)) return 'gate-or-process';
  return 'preference';
}
