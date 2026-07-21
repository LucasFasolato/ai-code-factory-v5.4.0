import { aiPath } from '../core/paths.js';
import { readJsonSafe, writeJson, writeText } from '../core/fs.js';
import { nowIso, bullet } from '../core/format.js';

export function saveEpicDecomposition(root, intake) {
  if (!intake.requires_decomposition && intake.work_type !== 'product_epic') return null;
  const existing = readJsonSafe(aiPath(root, 'epics', 'index.json'), { counter: 0, epics: [] }) || { counter: 0, epics: [] };
  const epicId = `EPIC-${String(Number(existing.counter || 0) + 1).padStart(3, '0')}`;
  const suggested = intake.suggested_reqs || [];
  const epic = {
    id: epicId,
    source_request_id: intake.request_id,
    title: intake.intent || intake.interpreted_intent,
    status: 'proposed',
    risk: intake.risk,
    difficulty: intake.difficulty,
    created_at: nowIso(),
    decisions: intake.decisions || [],
    questions: intake.questions || [],
    suggested_reqs: suggested.map((req, index) => ({
      proposed_id: `${intake.request_id}-SLICE-${String(index + 1).padStart(2, '0')}`,
      title: req.title,
      reason: req.reason,
      risk: req.risk,
      depends_on: req.depends_on || []
    }))
  };
  writeJson(aiPath(root, 'epics', `${epicId}.json`), epic);
  writeText(aiPath(root, 'epics', `${epicId}-roadmap.md`), renderEpicRoadmap(epic));
  existing.counter = Number(existing.counter || 0) + 1;
  existing.epics = [...(existing.epics || []), { id: epicId, source_request_id: intake.request_id, title: epic.title, status: epic.status }];
  writeJson(aiPath(root, 'epics', 'index.json'), existing);
  return epic;
}

function renderEpicRoadmap(epic) {
  return `# ${epic.id} — Proposed Roadmap\n\n` +
    `Source request: ${epic.source_request_id}\n\n` +
    `Status: ${epic.status}\n\n` +
    `Difficulty: ${epic.difficulty}\nRisk: ${epic.risk}\n\n` +
    `## Title\n\n${epic.title}\n\n` +
    `## Orchestrator decisions\n\n${epic.decisions.length ? epic.decisions.map((d) => `- ${d.decision}: ${d.why}`).join('\n') : '- none'}\n\n` +
    `## Critical questions\n\n${epic.questions.length ? epic.questions.map((q) => `- ${q.text}`).join('\n') : '- none'}\n\n` +
    `## Suggested slices\n\n${epic.suggested_reqs.length ? epic.suggested_reqs.map((req, i) => `${i + 1}. **${req.title}** (${req.risk})\n   - Why: ${req.reason}\n   - Depends on: ${req.depends_on?.length ? req.depends_on.join(', ') : 'none'}`).join('\n') : '- No slices proposed.'}\n\n` +
    `## Next\n\nAnswer critical questions, then create/approve the first small REQ. Do not execute the whole epic as one implementation.\n`;
}
