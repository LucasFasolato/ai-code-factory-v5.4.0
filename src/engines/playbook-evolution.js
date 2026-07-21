import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readJson, readText, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';
import { countFailureClasses } from './memory-compiler.js';

// Adaptive Playbooks: every applied change snapshots the previous version into
// .ai/playbooks/versions/. Upgrades are proposed first; applying requires
// --apply (or evolution.allow_autonomous_playbook_updates=true).
export function playbookUpgrade(root, options = {}) {
  const config = readJson(aiPath(root, 'config.json'), {}) || {};
  const autonomousAllowed = config.evolution?.allow_autonomous_playbook_updates === true;
  const apply = Boolean(options.apply) || autonomousAllowed;

  const failureCounts = countFailureClasses(root);
  const preferences = readJson(aiPath(root, 'knowledge', 'user-preferences.json'), {}) || {};
  const learnedRules = (preferences.learned_rules || []).map((r) => (typeof r === 'string' ? r : r.rule));

  const proposals = buildProposals(failureCounts, learnedRules);
  if (!proposals.length) return { status: 'no_changes', applied: false, proposals: [], message: 'No playbook upgrades suggested by current history.' };

  const proposalFile = aiPath(root, 'improvements', 'proposals', `playbook-upgrade-${Date.now()}.md`);
  writeText(proposalFile, `# Playbook Upgrade Proposal\n\nGenerated at: ${nowIso()}\n\n` +
    proposals.map((p) => `## ${p.playbook}\n\n${p.additions.map((a) => `- ${a}`).join('\n')}\n`).join('\n') +
    `\n## Apply\n\nnpm run ai -- playbook-upgrade --apply\n`);

  let applied = [];
  if (apply) {
    for (const p of proposals) {
      const target = aiPath(root, 'playbooks', p.playbook);
      const current = readText(target, `# Playbook — ${p.playbook}\n`);
      snapshotVersion(root, p.playbook, current);
      const section = `\n## Learned rules (${nowIso().slice(0, 10)})\n\n${p.additions.map((a) => `- ${a}`).join('\n')}\n`;
      writeText(target, current + section);
      applied.push(p.playbook);
    }
    appendEvent(root, 'IMPROVEMENT_PROPOSED', { kind: 'playbook-upgrade', applied });
  }
  return { status: 'ok', applied: apply, applied_playbooks: applied, proposals, proposal_file: proposalFile };
}

function buildProposals(failureCounts, learnedRules) {
  const proposals = [];
  const map = {
    visual: { playbook: 'frontend-visual.md', rule: 'Capture visual evidence immediately after implementation; do not defer screenshots.' },
    technical: { playbook: 'bugfix.md', rule: 'Run auto-iterate on safe technical blockers before asking for human review.' },
    executor: { playbook: 'frontend-visual.md', rule: 'Split large execution contracts; check executor timeout before retrying.' },
    user_input_gap: { playbook: 'frontend-visual.md', rule: 'Answer blocking questions before approve; never execute with blocking info pending.' },
    product: { playbook: 'landing.md', rule: 'Re-check acceptance criteria and fake-data scan right before requesting approval.' }
  };
  const byPlaybook = {};
  for (const [cls, count] of Object.entries(failureCounts)) {
    if (count >= 2 && map[cls]) {
      const { playbook, rule } = map[cls];
      (byPlaybook[playbook] = byPlaybook[playbook] || new Set()).add(`${rule} (observed ${count}x: ${cls})`);
    }
  }
  for (const rule of learnedRules.slice(-10)) {
    (byPlaybook['frontend-visual.md'] = byPlaybook['frontend-visual.md'] || new Set()).add(rule);
  }
  for (const [playbook, additions] of Object.entries(byPlaybook)) proposals.push({ playbook, additions: [...additions] });
  return proposals;
}

function snapshotVersion(root, playbookName, content) {
  const versionsDir = aiPath(root, 'playbooks', 'versions');
  fs.mkdirSync(versionsDir, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  writeText(path.join(versionsDir, `${playbookName.replace(/\.md$/, '')}-${stamp}.md`), content);
}

export function listPlaybookVersions(root) {
  const versionsDir = aiPath(root, 'playbooks', 'versions');
  if (!fs.existsSync(versionsDir)) return [];
  return fs.readdirSync(versionsDir).filter((n) => n.endsWith('.md')).sort();
}
