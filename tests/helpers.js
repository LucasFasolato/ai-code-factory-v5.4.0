import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureAiWorkspace, nextRequestId, saveRequest } from '../src/core/state.js';
import { analyzeAsk } from '../src/engines/intake-engine.js';
import { saveQuestions } from '../src/engines/question-engine.js';
import { saveImprovedSpec } from '../src/engines/spec-improver.js';
import { saveJudgment } from '../src/engines/judgment-engine.js';
import { saveRoutingDecision, initialStatusFor } from '../src/engines/workflow-router.js';
import { saveRiskRegister } from '../src/engines/risk-engine.js';
import { saveImpactAnalysis } from '../src/engines/impact-engine.js';
import { saveContextPack } from '../src/engines/context-pack-engine.js';
import { requestPaths } from '../src/core/paths.js';
import { writeJson } from '../src/core/fs.js';

export function makeTempProject(prefix = 'acf-test-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  ensureAiWorkspace(root);
  return root;
}

export function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

// Creates a full request with all intake artifacts, like the ask command does.
export function createRequest(root, ask, config = {}) {
  const requestId = nextRequestId(root);
  const intake = analyzeAsk(ask, requestId, config);
  saveRequest(root, {
    id: requestId,
    title: ask.slice(0, 80),
    raw_user_ask: ask,
    work_type: intake.work_type,
    project_type: intake.project_type,
    risk: intake.risk,
    workflow: intake.recommended_workflow,
    status: initialStatusFor(intake),
    next_best_action: intake.next_best_action,
    created_at: new Date().toISOString()
  });
  writeJson(requestPaths(root, requestId).intake, intake);
  saveQuestions(root, intake);
  saveImprovedSpec(root, intake);
  const judgment = saveJudgment(root, intake, config);
  saveRoutingDecision(root, intake, judgment);
  saveRiskRegister(root, intake);
  saveImpactAnalysis(root, intake);
  saveContextPack(root, requestId);
  return { requestId, intake };
}

export function writeFakePng(root, name = 'design.png') {
  const file = path.join(root, name);
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return file;
}
