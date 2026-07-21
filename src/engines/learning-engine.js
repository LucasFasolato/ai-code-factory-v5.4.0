import fs from 'node:fs';
import path from 'node:path';
import { exists, readJson, readText, writeText, writeJson, appendText } from '../core/fs.js';
import { aiPath, requestPaths } from '../core/paths.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';
import { classifyFailures } from './replay-engine.js';

export function generateLearning(root, requestId, options = {}) {
  const paths = requestPaths(root, requestId);
  const selfReview = readText(paths.selfReview, 'Self review missing.');
  const evidence = readText(paths.evidence, 'Evidence missing.');
  const classification = classifyFailures(root, requestId);

  const learning = `# Learning — ${requestId}\n\n` +
    `Generated at: ${nowIso()}\n\n` +
    `## What worked\n\n- Context pack and gates produced an auditable path.\n- Evidence pack clarifies close status.\n\n` +
    `## Failure classification\n\n${classification.classes.length ? classification.classes.map((c) => `- ${c.class}: ${c.reason}`).join('\n') : '- No failures classified.'}\n\n` +
    `## What to improve\n\n${extractProblems(selfReview, evidence)}\n\n` +
    `## Proposed rule updates\n\n- Preserve simple CLI while improving dashboard visibility.\n- Add/adjust playbook rules only with approval.\n`;
  writeText(paths.learning, learning);
  appendEvent(root, 'LEARNING_CREATED', { request_id: requestId, failure_classes: classification.classes.map((c) => c.class) });

  if (options.apply) {
    appendText(aiPath(root, 'memory', 'project-lessons.md'), `\n\n---\n\n${learning}\n`);
  }

  const proposal = maybeProposeImprovement(root, requestId, classification, options);
  return { request_id: requestId, applied: Boolean(options.apply), classification, proposal, markdown: learning };
}

// If the same failure class repeats across REQs, write an improvement proposal.
export function maybeProposeImprovement(root, requestId, classification, options = {}) {
  const config = readJson(aiPath(root, 'config.json'), {}) || {};
  const minRepeats = config.evolution?.min_repeated_failures_for_proposal ?? 2;
  const failuresDir = aiPath(root, 'history', 'failures');
  if (!fs.existsSync(failuresDir)) return null;
  const counts = {};
  for (const name of fs.readdirSync(failuresDir).filter((n) => n.endsWith('.json'))) {
    const data = readJson(path.join(failuresDir, name), null);
    for (const c of data?.classes || []) counts[c.class] = (counts[c.class] || 0) + 1;
  }
  const repeated = Object.entries(counts).filter(([, n]) => n >= minRepeats);
  if (!repeated.length) return null;
  const proposalFile = aiPath(root, 'improvements', 'proposals', `proposal-${Date.now()}.md`);
  const md = `# Improvement Proposal\n\nGenerated at: ${nowIso()}\nTriggered by: ${requestId}\n\n` +
    `## Repeated failure classes\n\n${repeated.map(([cls, n]) => `- ${cls}: ${n} occurrences`).join('\n')}\n\n` +
    `## Proposal\n\nReview the playbooks/gates covering these classes and add a prevention rule or regression test for each.\n\n` +
    `## Risk\n\nLow — proposal only; nothing is applied automatically.\n\n## Requires approval\n\nYes. Apply with: npm run ai -- playbook-upgrade\n`;
  writeText(proposalFile, md);
  appendEvent(root, 'IMPROVEMENT_PROPOSED', { request_id: requestId, repeated: Object.fromEntries(repeated) });
  return { path: proposalFile, repeated: Object.fromEntries(repeated) };
}

function extractProblems(selfReview, evidence) {
  const combined = `${selfReview}\n${evidence}`;
  const lines = combined.split('\n').filter((line) => /pending|failed|problem|blocker|missing/i.test(line));
  return lines.length ? lines.slice(0, 12).map((line) => `- ${line.replace(/^[-#\s]*/, '')}`).join('\n') : '- No explicit problems found.';
}
