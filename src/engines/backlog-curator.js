import { aiPath, requestPaths } from '../core/paths.js';
import { exists, readJson } from '../core/fs.js';
import { listBacklog } from '../core/state.js';
import { nowIso } from '../core/format.js';
import { projectHealth } from './health-engine.js';
import { findTestGaps } from './test-gap-finder.js';
import { detectArchitectureDrift } from './architecture-drift.js';
import { countFailureClasses } from './memory-compiler.js';

// suggest-next: proposes the next best REQs based on health, open blockers,
// failure history, test gaps and architecture drift. Proposal-only.
export function suggestNext(root) {
  const suggestions = [];
  const backlog = listBacklog(root);

  // 1) Unblock open work first.
  for (const req of backlog) {
    if (['done', 'superseded', 'failed'].includes(req.status)) continue;
    const paths = requestPaths(root, req.id);
    const gates = exists(paths.gates) ? readJson(paths.gates, null) : null;
    if (gates && !gates.close_allowed && (gates.close_blockers || []).length) {
      suggestions.push(s('unblock', `Resolve blockers of ${req.id} (${req.title})`, `Blockers: ${gates.close_blockers.slice(0, 3).join('; ')}`, 'high'));
    } else if (req.next_best_action) {
      suggestions.push(s('continue', `Continue ${req.id}: ${req.next_best_action}`, `Status: ${req.status}`, 'high'));
    }
  }

  // 2) Repeated failures → prevention REQ.
  const failureCounts = countFailureClasses(root);
  for (const [cls, count] of Object.entries(failureCounts)) {
    if (count >= 2) suggestions.push(s('prevention', `Create a prevention task for repeated "${cls}" failures`, `${count} occurrences. Consider playbook-upgrade and a regression test.`, 'medium'));
  }

  // 3) Test gaps.
  const gaps = findTestGaps(root);
  if (gaps.status === 'gaps_found' && gaps.gaps.length >= 3) {
    suggestions.push(s('quality', `Add tests for ${gaps.gaps.length} unreferenced source files`, `Examples: ${gaps.gaps.slice(0, 3).join(', ')}`, 'medium'));
  }

  // 4) Architecture drift.
  const drift = detectArchitectureDrift(root);
  for (const issueItem of drift.issues) {
    suggestions.push(s('architecture', `Fix architecture drift: ${issueItem.id}`, issueItem.message, 'medium'));
  }

  // 5) Health warnings.
  const health = projectHealth(root);
  for (const check of health.checks.filter((c) => !c.ok)) {
    suggestions.push(s('health', `Improve project health: ${check.message}`, `Health score: ${health.score}/100`, 'low'));
  }

  if (!suggestions.length) suggestions.push(s('explore', 'Backlog is clean — define the next product goal with ask', 'No blockers, gaps or drift detected.', 'low'));

  const ordered = suggestions.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)).slice(0, 12);
  return { generated_at: nowIso(), suggestions: ordered };
}

function s(kind, title, detail, priority) { return { kind, title, detail, priority }; }
function priorityRank(p) { return p === 'high' ? 0 : p === 'medium' ? 1 : 2; }
