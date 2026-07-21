#!/usr/bin/env node
import { VERSION } from './defaults.js';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getProjectRoot, aiPath, requestPaths } from './core/paths.js';
import { exists, readJson, readJsonSafe, readText, writeJson, writeText, appendText, listFilesRecursive } from './core/fs.js';
import { ensureAiWorkspace, loadConfig, loadState, nextRequestId, getActiveRequestId, listBacklog, loadRequest, updateRequest, saveRequest } from './core/state.js';
import { nowIso, bullet, statusIcon } from './core/format.js';
import { appendEvent } from './core/events.js';
import { analyzeAskWithBrain, previewAskWithBrain, brainStatus, brainDoctor } from './engines/ai-intake-brain.js';
import { executorAuthStatus } from './engines/executor-auth.js';
import { budgetConfig, readUsageSummary } from './engines/usage-budget.js';
import { saveQuestions } from './engines/question-engine.js';
import { saveImprovedSpec } from './engines/spec-improver.js';
import { saveJudgment } from './engines/judgment-engine.js';
import { saveRoutingDecision, initialStatusFor } from './engines/workflow-router.js';
import { saveRiskRegister } from './engines/risk-engine.js';
import { saveImpactAnalysis } from './engines/impact-engine.js';
import { saveContextPack } from './engines/context-pack-engine.js';
import { routeTools, mcpStatus, listMcpTools, setMcpToolEnabled, mcpDoctor } from './engines/mcp-router.js';
import { evaluateGates } from './engines/gate-engine.js';
import { scanFakeData } from './engines/fake-data-scanner.js';
import { createDesignBrief, generateDesignPromptPack, importDesign, approveDesign, designPreview, designCostPreview, designDoctor } from './engines/design-engine.js';
import { generateComponentPlan } from './engines/component-engine.js';
import { runWebResearch, runDesignResearch } from './engines/research-engine.js';
import { initStandards, standardsStatus, setQualityProfile, readProjectStandards } from './engines/standards-engine.js';
import { runFrontendReview, runBackendReview, runProductReview, runSecurityReview, runArchitectureReview } from './engines/senior-review-engine.js';
import { productScan, proposeFeatures, createReqFromProposal, autonomousCycle } from './engines/product-loop-engine.js';
import { proposeFeaturesWithBrain } from './engines/feature-proposer-engine.js';
import { generateApiContract, generateAdr } from './engines/contract-adr-engine.js';
import { saveExecutionContract } from './engines/execution-contract-engine.js';
import { runExecutor, runTechnicalValidation } from './engines/executor-orchestrator.js';
import { evaluateAcceptance } from './engines/acceptance-evaluator.js';
import { runSelfReview } from './engines/self-review-engine.js';
import { autoIterate } from './engines/auto-iteration-engine.js';
import { generateEvidencePack } from './engines/evidence-pack-engine.js';
import { generateLearning } from './engines/learning-engine.js';
import { projectHealth } from './engines/health-engine.js';
import { runStateDoctor } from './engines/state-doctor.js';
import { runQualityReview } from './engines/quality-engine.js';
import { runFunnelReview } from './engines/funnel-review-engine.js';
import { runVisualReview, acceptVisual } from './engines/visual-engine.js';
import { historyTimeline, lessonsSummary, evolutionSummary } from './engines/history-engine.js';
import { saveRepoMap } from './engines/repo-map-engine.js';
import { runDeterministicGates } from './engines/deterministic-gates.js';
import { listPlaybooks, recordPlaybook, matchPlaybook } from './engines/playbook-engine.js';
import { syncAgentsMd } from './engines/agents-md-engine.js';
import { seedGoldenSet, runBrainEval } from './engines/brain-eval.js';
import { applyGitPolicy, gitPolicyStatus } from './engines/git-policy.js';
import { buildCostReport } from './engines/cost-report-engine.js';
import { readProgress } from './engines/progress-engine.js';
import { buildStats, renderStats } from './engines/stats-engine.js';
import { listHooks, scaffoldHooks, HOOK_POINTS } from './engines/hooks-engine.js';
import { buildGuide, renderGuide } from './engines/guide-engine.js';
import { buildReviewPacket, renderReviewPacket } from './engines/review-engine.js';
import { compileMemory } from './engines/memory-compiler.js';
import { recordFeedback, mineFeedback } from './engines/feedback-engine.js';
import { replayRequest, counterfactualReview, rootCauseAnalysis, classifyFailures } from './engines/replay-engine.js';
import { decisionQuality, calibrateConfidence } from './engines/decision-quality-engine.js';
import { calibrateAutonomy, setAutonomyPreset } from './engines/autonomy-calibration.js';
import { playbookUpgrade, listPlaybookVersions } from './engines/playbook-evolution.js';
import { distillSkill, listSkills, buildPatterns } from './engines/skill-pattern-engine.js';
import { lockConstraint, unlockConstraint, listConstraints, checkConstraints } from './engines/constraint-engine.js';
import { detectArchitectureDrift } from './engines/architecture-drift.js';
import { findTestGaps } from './engines/test-gap-finder.js';
import { suggestNext } from './engines/backlog-curator.js';
import { startExperiment, recordMeasurement, compareExperiment, listExperiments } from './engines/experiment-engine.js';
import { saveEpicDecomposition } from './engines/epic-decomposer.js';
import { startDashboard } from './dashboard/server.js';
import { runSystemDoctor } from './engines/system-doctor.js';
import { runFullCycle } from './engines/full-cycle-engine.js';
import { bootstrapProject } from './engines/project-bootstrap.js';
import { gitWorkflowStatus } from './engines/git-workflow.js';

const root = getProjectRoot();

main().catch((error) => {
  console.error(`\nERROR: ${error.message || error}\n`);
  if (process.env.ACF_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});

async function main() {
  const argv = process.argv.slice(2);
  const command = normalizeCommand(argv.shift() || 'guide');
  if (command !== 'doctor:syntax') ensureAiWorkspace(root);
  const config = command !== 'doctor:syntax' ? loadConfig(root) : {};

  switch (command) {
    case 'help': return printHelp();
    case 'guide': return cmdGuide(config);
    case 'start': return cmdAsk(argv, config);
    case 'continue': return cmdCycle(argv, config);
    case 'review': return cmdReview(argv, config);
    case 'accept': return cmdAccept(argv, config);
    case 'init': return cmdInit();
    case 'doctor': return cmdSystemDoctor(config);
    case 'doctor:syntax': return cmdDoctorSyntax();
    case 'ask': return cmdAsk(argv, config);
    case 'status': return cmdStatus(argv, config);
    case 'next': return cmdNext(argv, config);
    case 'cycle': return cmdCycle(argv, config);
    case 'full-cycle': return cmdCycle(argv, config);
    case 'preview': return cmdPreview(argv, config);
    case 'approve': return cmdApprove(argv, config);
    case 'approve-dry-run': return cmdApprove(['--dry-run', ...argv], config);
    case 'validate': return cmdValidate(argv, config);
    case 'recover-execution': return cmdRecoverExecution(argv, config);
    case 'questions': return cmdQuestions(argv);
    case 'answer': return cmdAnswer(argv);
    case 'why': return cmdWhy(argv);
    case 'intake-preview': return cmdIntakePreview(argv);
    case 'brain-status': return cmdBrainStatus(config);
    case 'brain-doctor': return cmdBrainDoctor(config);
    case 'ask-preview': return cmdAskPreview(argv, config);
    case 'brain-route': return cmdAskPreview(argv, config);
    case 'next-step': return cmdNextStep(argv, config);
    case 'executor-status': return cmdExecutorStatus(config);
    case 'cost-status': return cmdCostStatus(config);
    case 'context-pack': return cmdContextPack(argv);
    case 'gate-check': return cmdGateCheck(argv, config);
    case 'health': return cmdHealth();
    case 'state-doctor': return cmdStateDoctor();
    case 'project-bootstrap': return cmdProjectBootstrap(argv, config);
    case 'branch-status': return cmdBranchStatus(argv);
    case 'fix-intake': return cmdFixIntake(argv, config);
    case 'auto-iterate': return cmdAutoIterate(argv, config);
    case 'evidence': return cmdEvidence(argv);
    case 'learn': return cmdLearn(argv);
    case 'quality': return cmdQuality(argv);
    case 'funnel-review': return cmdFunnelReview(argv);
    case 'fake-data-scan': return cmdFakeDataScan(config);
    case 'dashboard': return cmdDashboard(argv, config);
    case 'mcp': return cmdMcp(argv);
    case 'design-brief': return cmdDesignBrief(argv);
    case 'design-generate': return cmdDesignGenerate(argv, config);
    case 'design-import': return cmdDesignImport(argv);
    case 'design-preview': return cmdDesignPreview(argv);
    case 'design-approve': return cmdDesignApprove(argv, config);
    case 'design-provider': return cmdDesignProvider(argv, config);
    case 'design-doctor': return cmdDesignDoctor(config);
    case 'visual-review': return cmdVisualReview(argv, config);
    case 'visual-accept': return cmdVisualAccept(argv, config);
    case 'screenshot-import': return cmdScreenshotImport(argv, config);
    case 'component-plan': return cmdComponentPlan(argv, config);
    case 'research-web': return cmdResearchWeb(argv, config);
    case 'design-research': return cmdDesignResearch(argv, config);
    case 'standards': return cmdStandards(argv, config);
    case 'quality-profile': return cmdQualityProfile(argv, config);
    case 'design-quality': return cmdDesignQuality(argv, config);
    case 'design-creativity': return cmdDesignCreativity(argv, config);
    case 'design-cost-preview': return cmdDesignCostPreview(argv, config);
    case 'override-workflow': return cmdOverrideWorkflow(argv, config);
    case 'design-score': return cmdDesignScore(argv, config);
    case 'product-scan': return cmdProductScan(argv, config);
    case 'propose-features': return cmdProposeFeatures(argv, config);
    case 'create-req-from-proposal': return cmdCreateReqFromProposal(argv, config);
    case 'autonomous-cycle': return cmdAutonomousCycle(argv, config);
    case 'run-loop': return cmdAutonomousCycle(argv, config);
    case 'frontend-review': return cmdFrontendReview(argv, config);
    case 'backend-review': return cmdBackendReview(argv, config);
    case 'product-review': return cmdProductReview(argv, config);
    case 'security-review': return cmdSecurityReview(argv, config);
    case 'architecture-review': return cmdArchitectureReview(argv, config);
    case 'api-contract': return cmdApiContract(argv, config);
    case 'adr': return cmdAdr(argv, config);
    // --- Evolution commands ---
    case 'history': return cmdHistory(argv);
    case 'lessons': return cmdLessons();
    case 'evolution': return cmdEvolution();
    case 'compile-memory': return cmdCompileMemory();
    case 'feedback': return cmdFeedback(argv);
    case 'mine-feedback': return cmdMineFeedback();
    case 'replay': return cmdReplay(argv);
    case 'counterfactual': return cmdCounterfactual(argv);
    case 'setup': return cmdSetup(argv, config);
    case 'progress': return cmdProgress(argv);
    case 'stats': return cmdStats(config);
    case 'hooks': return cmdHooks(config, argv);
    case 'repo-map': return cmdRepoMap();
    case 'det-gates': return cmdDetGates(argv, config);
    case 'playbooks': return cmdPlaybooks(argv);
    case 'agents-md': return cmdAgentsMd(argv);
    case 'brain-eval': return cmdBrainEval(argv, config);
    case 'git-policy': return cmdGitPolicy(argv, config);
    case 'cost-report': return cmdCostReport(argv, config);
    case 'root-cause': return cmdRootCause(argv);
    case 'classify-failures': return cmdClassifyFailures(argv);
    case 'decision-quality': return cmdDecisionQuality(argv);
    case 'confidence-calibration': return cmdConfidenceCalibration();
    case 'calibrate-autonomy': return cmdCalibrateAutonomy(argv);
    case 'autonomy': return cmdAutonomy(argv);
    case 'dna': return cmdDna(argv);
    case 'playbook-upgrade': return cmdPlaybookUpgrade(argv);
    case 'distill-skill': return cmdDistillSkill(argv);
    case 'skills': return cmdSkills();
    case 'patterns': return cmdPatterns();
    case 'lock-constraint': return cmdLockConstraint(argv);
    case 'unlock-constraint': return cmdUnlockConstraint(argv);
    case 'constraints': return cmdConstraints(argv, config);
    case 'architecture-drift': return cmdArchitectureDrift();
    case 'test-gaps': return cmdTestGaps();
    case 'suggest-next': return cmdSuggestNext();
    case 'improve-self': return cmdImproveSelf();
    case 'experiment': return cmdExperiment(argv);
    default:
      throw new Error(`Unknown command: ${command}. Run npm run ai -- help`);
  }
}

function normalizeCommand(command) {
  const aliases = {
    ui: 'dashboard',
    gates: 'gate-check',
    gate: 'gate-check',
    context: 'context-pack',
    design: 'design-preview',
    timeline: 'history',
    branch: 'branch-status',
    bootstrap: 'project-bootstrap'
  };
  return aliases[command] || command;
}

function cmdInit() {
  ensureAiWorkspace(root);
  console.log(`AI Code Factory v${VERSION} initialized.`);
  console.log('Created/verified .ai workspace with brain-first routing, branch workflow, events, history, knowledge, skills and patterns.');
  console.log('Tip: run `npm run ai -- project-bootstrap` once in new projects to ensure validation scripts and git baseline.');
}

async function runAskPipeline(ask, config, options = {}, extra = {}) {
  const requestId = nextRequestId(root);
  const intake = await analyzeAskWithBrain(root, ask, requestId, config, options);
  const status = initialStatusFor(intake);
  const request = {
    id: requestId,
    title: makeTitle(ask),
    raw_user_ask: ask,
    interpreted_intent: intake.interpreted_intent,
    work_type: intake.work_type,
    project_type: intake.project_type,
    risk: intake.risk,
    workflow: intake.recommended_workflow,
    status,
    next_best_action: intake.next_best_action,
    created_at: nowIso(),
    updated_at: nowIso(),
    ...extra
  };
  saveRequest(root, request);
  writeJson(requestPaths(root, requestId).intake, intake);
  appendEvent(root, 'ASK_CREATED', { request_id: requestId, ask });
  const questions = saveQuestions(root, intake);
  if (questions.questions.length) appendEvent(root, 'QUESTION_CREATED', { request_id: requestId, count: questions.questions.length });
  saveImprovedSpec(root, intake);
  const judgment = saveJudgment(root, intake, config);
  saveRoutingDecision(root, intake, judgment);
  appendEvent(root, 'WORKFLOW_SELECTED', { request_id: requestId, workflow: intake.recommended_workflow, work_type: intake.work_type });
  if (intake.design_first_required) appendEvent(root, 'DESIGN_REQUIRED', { request_id: requestId });
  saveRiskRegister(root, intake);
  saveImpactAnalysis(root, intake);
  routeTools(root, intake);
  const epic = saveEpicDecomposition(root, intake);
  if (epic) appendEvent(root, 'EPIC_PROPOSED', { request_id: requestId, epic_id: epic.id, slices: epic.suggested_reqs.length });
  saveContextPack(root, requestId);
  evaluateGates(root, requestId, config, { skipFakeScan: true });
  appendEvent(root, 'INTAKE_COMPLETED', { request_id: requestId, work_type: intake.work_type, confidence: intake.confidence, risk: intake.risk });
  return { requestId, intake, status };
}

async function cmdAsk(argv, config) {
  const parsed = parseBrainFlags(argv);
  const ask = parsed.rest.join(' ').trim();
  if (!ask) throw new Error('Usage: npm run ai -- ask "..."');
  const { requestId, intake, status } = await runAskPipeline(ask, config, parsed.options);

  console.log(`Created ${requestId}`);
  console.log(`Intent: ${intake.interpreted_intent}`);
  const esc = intake.brain?.escalation;
  const brainModel = intake.brain?.model && intake.brain.model !== 'claude-code-cli' ? ` · model: ${intake.brain.model}` : '';
  const escNote = esc ? ` · escalated ${esc.from}→${esc.to} (${esc.reason})` : '';
  console.log(`Brain: ${intake.brain?.source || 'heuristic'}${brainModel}${escNote}${intake.brain?.fallback_reason ? ` (fallback: ${intake.brain.fallback_reason})` : ''}`);
  if (intake.brain?.brain_degraded) {
    console.log('');
    console.log('⚠️  BRAIN DEGRADED — Claude (the thinking brain) was unavailable.');
    console.log('   This decision came from the deterministic heuristic, the last-resort fallback.');
    console.log('   Implementation is on hold. Run `npm run ai -- brain-doctor`, restore Claude, then re-run `ask`.');
    console.log('');
  }
  console.log(`Work type: ${intake.work_type}`);
  console.log(`Difficulty: ${intake.difficulty || 'unknown'} | Scope: ${intake.scope || 'unknown'}`);
  console.log(`Workflow: ${intake.recommended_workflow}`);
  console.log(`Risk: ${intake.risk}`);
  console.log(`Status: ${status}`);
  if (intake.requires_decomposition) console.log('Product epic detected: implementation is blocked until it is split into child REQs.');
  if (intake.design_first_required) console.log('Design-first required before implementation.');
  if (intake.missing_info.length) console.log(`Missing info: ${intake.missing_info.join(', ')}`);
  if (intake.questions?.length) console.log(`Questions: ${intake.questions.length} critical/intake question(s) generated.`);
  if (intake.suggested_reqs?.length) console.log(`Roadmap: ${intake.suggested_reqs.length} suggested REQ slice(s).`);
  console.log(`Next: ${intake.next_best_action}`);
}

function cmdStatus(argv, config) {
  const active = resolveRequestId(argv[0], false);
  const backlog = listBacklog(root);
  const state = loadState(root);
  console.log(`AI Code Factory v${VERSION} — Reliable Brain, Token Economy & Deterministic Quality OS`);
  console.log(`Active: ${state.active_request_id || 'none'}`);
  console.log(`Mode: ${state.mode} | Autonomy: ${state.autonomy_level}`);
  console.log('');
  if (!active) {
    printBacklog(backlog);
    return;
  }
  const req = loadRequest(root, active);
  if (!req) throw new Error(`Request not found: ${active}`);
  const gates = exists(requestPaths(root, active).gates) ? readJson(requestPaths(root, active).gates, null) : evaluateGates(root, active, config, { skipFakeScan: true });
  console.log(`${req.id} — ${req.title}`);
  console.log(`Status: ${req.status}`);
  console.log(`Type: ${req.work_type} | Workflow: ${req.workflow} | Risk: ${req.risk}`);
  console.log(`Next: ${req.next_best_action || 'none'}`);
  console.log(`Close allowed: ${gates.close_allowed ? 'yes' : 'no'}`);
  if (gates.close_blockers?.length) console.log(`Blockers:\n${bullet(gates.close_blockers)}`);
}

function cmdCycle(argv, config) {
  const requestId = resolveRequestId(argv.find((a) => !a.startsWith('--')) || null);
  const result = runFullCycle(root, requestId, config, {
    dryRun: argv.includes('--dry-run'),
    humanApproved: argv.includes('--approved'),
    autoFix: !argv.includes('--no-auto-fix'),
    applyLearning: argv.includes('--apply-learning'),
    forceExecute: argv.includes('--force-execute')
  });
  console.log(`Full cycle for ${requestId}: ${result.status.toUpperCase()}`);
  for (const s of result.steps || []) {
    console.log(`  • ${s.step}${s.detail ? ` — ${JSON.stringify(s.detail)}` : ''}`);
  }
  if (result.status === 'stopped') {
    console.log(`\n⛔ Stopped: ${result.stopped_reason}`);
    console.log(`   Next: ${result.next_action}`);
    process.exitCode = 1;
  } else if (result.status === 'completed') {
    console.log(`\n✅ REQ ${requestId} completed the full cycle in ${result.iterations} auto-fix iteration(s).`);
    console.log(`   Next: ${result.next_action}`);
  } else {
    console.log(`\nResult: ${result.stopped_reason || 'see log'}`);
    process.exitCode = 1;
  }
}

function cmdNext(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const req = loadRequest(root, requestId);
  const intake = readJson(requestPaths(root, requestId).intake, null);
  if (!req || !intake) throw new Error(`Request not ready: ${requestId}`);

  if (req.status === 'intake_ready' && intake.design_first_required) {
    const brief = createDesignBrief(root, requestId);
    saveContextPack(root, requestId);
    console.log(`Design brief created: ${brief.path}`);
    console.log('Next: npm run ai -- design-generate or design-import');
    return;
  }
  if (req.status === 'design_plan_ready') {
    const result = generateDesignPromptPack(root, requestId, config);
    saveContextPack(root, requestId);
    console.log(`Design prompt pack created: ${result.prompt_file}`);
    console.log(`Manifest status: ${result.manifest.status}`);
    console.log('Next: import generated images or approve a real option after artifacts exist.');
    return;
  }
  if (req.status === 'design_approved') {
    saveContextPack(root, requestId);
    saveExecutionContract(root, requestId);
    updateRequest(root, requestId, { status: 'implementation_ready', next_best_action: 'preview then approve execution' });
    appendEvent(root, 'PLAN_CREATED', { request_id: requestId });
    console.log('Implementation contract ready.');
    console.log('Next: npm run ai -- preview, then npm run ai -- approve');
    return;
  }
  if (req.status === 'implementation_ready') return cmdPreview([requestId], config);
  console.log(`Next best action for ${requestId}: ${req.next_best_action || 'inspect status'}`);
}

function cmdPreview(argv) {
  const requestId = resolveRequestId(argv[0]);
  saveContextPack(root, requestId);
  const contract = saveExecutionContract(root, requestId);
  console.log(`Preview for ${requestId}`);
  console.log(`Context pack: ${requestPaths(root, requestId).contextPack}`);
  console.log(`Executor contract: ${requestPaths(root, requestId).contract}`);
  console.log('');
  console.log(contract.markdown.slice(0, 1800));
  if (contract.markdown.length > 1800) console.log('\n...[preview truncated]');
}

function cmdApprove(argv, config) {
  const dryRun = argv.includes('--dry-run') || argv.includes('dry-run') || process.env.npm_config_dry_run === 'true';
  const requestId = resolveRequestId(argv.find((x) => !x.startsWith('--') && x !== 'dry-run') || null);
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  if ((intake.requires_decomposition || intake.work_type === 'product_epic') && !argv.includes('--force-epic')) {
    evaluateGates(root, requestId, config);
    throw new Error('Product epic gate blocked execution. Split this epic into child REQs before approving implementation. Use override-workflow for a closable slice, not --force-epic by default.');
  }
  if (intake.design_first_required && !exists(paths.approvedDesign)) {
    evaluateGates(root, requestId, config);
    throw new Error('Design-first gate blocked execution. Approve a design first with design-approve.');
  }
  saveContextPack(root, requestId);
  saveExecutionContract(root, requestId);

  if (dryRun) {
    const execution = runExecutor(root, requestId, config, { dryRun: true });
    const validation = {
      request_id: requestId,
      status: 'skipped',
      reason: 'dry-run: validation intentionally not run',
      commands: [],
      generated_at: nowIso()
    };
    writeJson(paths.validation, validation);
    const acceptance = evaluateAcceptance(root, requestId);
    runSelfReview(root, requestId);
    const gates = evaluateGates(root, requestId, config);
    const evidence = generateEvidencePack(root, requestId);
    updateRequest(root, requestId, { status: 'implementation_ready', next_best_action: 'approve real execution or adjust contract' });
    console.log('Dry run: no executor changes were made.');
    console.log(`Execution: ${execution.status}`);
    console.log(`Validation: ${validation.status}`);
    console.log(`Acceptance: ${acceptance.summary}`);
    console.log(`Close allowed: ${gates.close_allowed ? 'yes' : 'no'}`);
    console.log(`Evidence: ${evidence.path}`);
    if (gates.close_blockers.length) console.log(`Blockers:\n${bullet(gates.close_blockers)}`);
    return;
  }

  updateRequest(root, requestId, { status: 'executing', next_best_action: 'wait for validation' });
  const execution = runExecutor(root, requestId, config, { dryRun: false });
  const validation = runTechnicalValidation(root, requestId, config);
  const acceptance = evaluateAcceptance(root, requestId);
  runSelfReview(root, requestId);
  const gates = evaluateGates(root, requestId, config);
  const evidence = generateEvidencePack(root, requestId);
  const nextStatus = gates.close_allowed ? 'done' : (intake.needs_visual_acceptance ? 'needs_visual_acceptance' : 'validated_technically');
  updateRequest(root, requestId, { status: nextStatus, next_best_action: gates.close_allowed ? 'learn' : 'resolve close blockers' });
  if (gates.close_allowed) appendEvent(root, 'REQ_CLOSED', { request_id: requestId });
  console.log(`Execution: ${execution.status}${execution.timed_out ? ' (timed out)' : ''}`);
  if (execution.files_touched?.length) console.log(`Files touched: ${execution.files_touched.length}`);
  console.log(`Validation: ${validation.status}`);
  console.log(`Acceptance: ${acceptance.summary}`);
  console.log(`Close allowed: ${gates.close_allowed ? 'yes' : 'no'}`);
  console.log(`Evidence: ${evidence.path}`);
  if (gates.close_blockers.length) console.log(`Blockers:\n${bullet(gates.close_blockers)}`);
}

function cmdValidate(argv, config) {
  const requestId = resolveRequestId(argv[0] || null);
  saveContextPack(root, requestId);
  const validation = runTechnicalValidation(root, requestId, config);
  const acceptance = evaluateAcceptance(root, requestId);
  runSelfReview(root, requestId);
  const gates = evaluateGates(root, requestId, config);
  const evidence = generateEvidencePack(root, requestId);
  const nextStatus = gates.close_allowed ? 'done' : (validation.status === 'passed' ? 'validated_technically' : 'validation_failed');
  updateRequest(root, requestId, { status: nextStatus, next_best_action: gates.close_allowed ? 'learn' : 'resolve close blockers' });
  if (gates.close_allowed) appendEvent(root, 'REQ_CLOSED', { request_id: requestId });
  console.log(`Validation: ${validation.status}`);
  console.log(`Acceptance: ${acceptance.summary}`);
  console.log(`Close allowed: ${gates.close_allowed ? 'yes' : 'no'}`);
  console.log(`Evidence: ${evidence.path}`);
  if (gates.close_blockers.length) console.log(`Blockers:\n${bullet(gates.close_blockers)}`);
}

function cmdRecoverExecution(argv, config) {
  const requestId = resolveRequestId(argv[0] || null);
  const paths = requestPaths(root, requestId);
  const execution = exists(paths.executionStatus) ? readJson(paths.executionStatus, null) : null;
  if (!execution) throw new Error(`No execution status found for ${requestId}.`);
  const validation = runTechnicalValidation(root, requestId, config);
  const acceptance = evaluateAcceptance(root, requestId);
  if (execution.timed_out && execution.files_touched?.length && validation.status === 'passed') {
    const recovered = { ...execution, status: 'recovered', reason: 'Executor timed out, but files were touched and validation passed during recovery.', recovered_at: nowIso() };
    writeJson(paths.executionStatus, recovered);
  }
  runSelfReview(root, requestId);
  const gates = evaluateGates(root, requestId, config);
  const evidence = generateEvidencePack(root, requestId);
  updateRequest(root, requestId, { status: gates.close_allowed ? 'done' : 'validated_technically', next_best_action: gates.close_allowed ? 'learn' : 'resolve remaining blockers' });
  console.log(`Recovery validation: ${validation.status}`);
  console.log(`Acceptance: ${acceptance.summary}`);
  console.log(`Recovered: ${execution.timed_out && execution.files_touched?.length && validation.status === 'passed' ? 'yes' : 'no'}`);
  console.log(`Close allowed: ${gates.close_allowed ? 'yes' : 'no'}`);
  console.log(`Evidence: ${evidence.path}`);
  if (gates.close_blockers.length) console.log(`Blockers:\n${bullet(gates.close_blockers)}`);
}

function cmdBrainStatus(config) {
  const status = brainStatus(root, config);
  console.log('Orchestrator Brain status');
  console.log(`Enabled: ${status.enabled}`);
  console.log(`Mode: ${status.mode}`);
  console.log(`Provider: ${status.provider}`);
  console.log(`Fallback chain: ${(status.fallback_chain || []).join(' → ')}`);
  console.log(`Model: ${status.model}`);
  console.log(`Claude Code command: ${status.claude_code_command} ${(status.claude_code_args || []).join(' ')}`);
  console.log(`Claude Code prompt mode: ${status.claude_code_prompt_mode}`);
  console.log(`API key env: ${status.api_key_env}`);
  console.log(`API key present: ${status.api_key_present ? 'yes' : 'no'}`);
  console.log(`Config: ${status.config_file}`);
  console.log(`Local config override: ${status.local_config_file}`);
  console.log(`Optional .env file: ${status.env_file}`);
  console.log(`Usage this month: ${status.usage_calls} call(s), ~$${Number(status.usage_estimated_cost_usd || 0).toFixed(4)}`);
}

function cmdBrainDoctor(config) {
  const status = brainDoctor(root, config);
  console.log('Brain doctor');
  console.log(`Configured provider: ${status.configured_provider}`);
  console.log(`Mode: ${status.mode}`);
  console.log(`Fallback chain: ${(status.fallback_chain || []).join(' → ')}`);
  console.log('');
  console.log('Claude Code Brain:');
  console.log(`- command: ${status.claude_code.command} ${(status.claude_code.args || []).join(' ')}`);
  console.log(`- prompt mode: ${status.claude_code.prompt_mode}`);
  console.log(`- sanitize API env: ${status.claude_code.sanitize_api_env ? 'yes' : 'no'}`);
  console.log(`- command found: ${status.claude_code.command_found ? 'yes' : 'no'}`);
  if (status.claude_code.version_output) console.log(`- version: ${status.claude_code.version_output.split('\\n')[0]}`);
  if (status.claude_code.error) console.log(`- error: ${status.claude_code.error}`);
  console.log('');
  console.log('OpenAI fallback:');
  console.log(`- API key present: ${status.openai.api_key_present ? 'yes' : 'no'}`);
  console.log('');
  console.log(`Heuristic fallback: ${status.heuristic.available ? 'available' : 'unavailable'}`);
  console.log(`Ready: ${status.ready ? 'yes' : 'no'}`);
  console.log(status.note);
}

async function cmdAskPreview(argv, config) {
  const parsed = parseBrainFlags(argv);
  const ask = parsed.rest.join(' ').trim();
  if (!ask) throw new Error('Usage: npm run ai -- ask-preview "..." [--brain-depth deep|architect] [--provider claude-code|openai|heuristic]');
  const preview = await previewAskWithBrain(root, ask, config, parsed.options);
  console.log('Ask preview — no artifacts written');
  console.log(`Intent preview: ${preview.heuristic.interpreted_intent}`);
  console.log(`Work type: ${preview.heuristic.work_type}`);
  console.log(`Difficulty: ${preview.route.difficulty}`);
  console.log(`Risk: ${preview.route.risk}`);
  console.log(`Provider route: ${(preview.route.fallback_chain || []).join(' → ')}`);
  console.log(`Depth: ${preview.route.depth}`);
  console.log(`Reasoning strategy: ${preview.route.reasoning_strategy}`);
  console.log(`External Brain call: ${preview.would_call_external_brain ? 'yes' : 'no'}`);
  console.log(`Reason: ${preview.route.routing_reason}`);
  console.log(`Max prompt chars: ${preview.route.max_prompt_chars}`);
  console.log(`Projected output tokens: ${preview.route.projected_output_tokens}`);
}

function cmdNextStep(argv, config) {
  const requestId = resolveRequestId(argv[0], false);
  if (!requestId) return console.log('No active request. Start with: npm run ai -- ask "..."');
  const req = loadRequest(root, requestId);
  const intake = readJson(requestPaths(root, requestId).intake, null);
  if (!req || !intake) return console.log(`No request artifacts for ${requestId}.`);
  console.log(`Current REQ: ${requestId}`);
  console.log(`Status: ${req.status}`);
  console.log(`Work type: ${req.work_type} | Risk: ${req.risk} | Workflow: ${req.workflow}`);
  console.log(`Brain: ${intake.brain?.source || 'unknown'} via ${intake.brain?.provider || 'unknown'}`);
  console.log(`Difficulty: ${intake.difficulty || 'unknown'} | Depth: ${intake.brain_depth || intake.brain?.route?.depth || 'n/a'} | Strategy: ${intake.reasoning_strategy || intake.brain?.route?.reasoning_strategy || 'n/a'}`);
  console.log('');
  console.log(`Next best action: ${req.next_best_action || intake.next_best_action || 'inspect status'}`);
  if ((intake.questions || []).length || (intake.blocking_missing_info || []).length) console.log(`Suggested command: npm run ai -- questions ${requestId}`);
  else if (intake.requires_decomposition) console.log('Suggested command: review .ai/epics roadmap, then create/ask first child REQ.');
  else if (intake.design_first_required) console.log(`Suggested command: npm run ai -- next ${requestId}`);
  else console.log(`Suggested command: npm run ai -- preview ${requestId}`);
}

function cmdExecutorStatus(config) {
  const status = executorAuthStatus(config);
  console.log('Executor auth status');
  console.log(`Mode: ${status.mode}`);
  console.log(`Sanitize API env for executor: ${status.sanitize_api_env ? 'yes' : 'no'}`);
  console.log(`Require ChatGPT login: ${status.require_chatgpt_login ? 'yes' : 'no'}`);
  console.log(`API env present in parent: ${status.api_env_present_in_parent.length ? status.api_env_present_in_parent.join(', ') : 'none'}`);
  console.log(`API env removed for executor: ${status.api_env_will_be_removed_for_executor.length ? status.api_env_will_be_removed_for_executor.join(', ') : 'none'}`);
  console.log(`Safe for ChatGPT plan execution: ${status.safe_for_chatgpt_plan_execution ? 'yes' : 'no'}`);
  if (status.warning) console.log(`Warning: ${status.warning}`);
}

function cmdCostStatus(config) {
  const summary = readUsageSummary(root);
  const budget = budgetConfig(config);
  console.log('AI usage / budget status');
  console.log(`Month: ${summary.month}`);
  console.log(`Calls: ${summary.calls}`);
  console.log(`Input tokens: ${summary.input_tokens}`);
  console.log(`Output tokens: ${summary.output_tokens}`);
  console.log(`Estimated cost: ~$${Number(summary.estimated_cost_usd || 0).toFixed(4)}`);
  console.log(`Budget enabled: ${budget.enabled ? 'yes' : 'no'}`);
  console.log(`Monthly budget: $${budget.monthly_budget_usd}`);
  console.log(`Hard stop ratio: ${budget.hard_stop_at_ratio}`);
  console.log(`Fallback when exceeded: ${budget.fallback_when_exceeded ? 'yes' : 'no'}`);
  if (Object.keys(summary.by_kind || {}).length) {
    console.log('By kind:');
    for (const [kind, item] of Object.entries(summary.by_kind)) {
      console.log(`- ${kind}: ${item.calls} call(s), ~$${Number(item.estimated_cost_usd || 0).toFixed(4)}`);
    }
  }
}


function cmdQuestions(argv) {
  const requestId = resolveRequestId(argv[0]);
  console.log(readText(requestPaths(root, requestId).questionsMd, `No questions for ${requestId}.`));
}

function cmdAnswer(argv) {
  const explicitId = /^REQ-\d{3,}$/.test(argv[0] || '') ? argv.shift() : null;
  const requestId = resolveRequestId(explicitId);
  const answer = argv.join(' ').trim();
  if (!answer) throw new Error('Usage: npm run ai -- answer [REQ-XXX] "..."');
  appendText(requestPaths(root, requestId).answersMd, `
## Answer — ${nowIso()}

${answer}
`);
  updateRequest(root, requestId, { status: 'intake_ready', next_best_action: 'continue workflow' });
  appendEvent(root, 'QUESTION_ANSWERED', { request_id: requestId, answer: answer.slice(0, 200) });
  saveContextPack(root, requestId);
  if (exists(requestPaths(root, requestId).contract)) saveExecutionContract(root, requestId);
  console.log(`Answer recorded for ${requestId}. Context pack updated.`);
}

function cmdWhy(argv) {
  const requestId = resolveRequestId(argv[0]);
  const paths = requestPaths(root, requestId);
  console.log(readText(paths.decision, 'Routing decision missing.'));
  const judgment = readJson(paths.judgment, null);
  if (judgment) {
    console.log('\n# Judgment\n');
    console.log(`Can proceed: ${judgment.can_proceed}`);
    console.log(`Proceed mode: ${judgment.proceed_mode}`);
    console.log(`Human approval required: ${judgment.human_approval_required}`);
    console.log(`Reason: ${judgment.reason}`);
  }
}

function cmdIntakePreview(argv) {
  const requestId = resolveRequestId(argv[0]);
  const intake = readJson(requestPaths(root, requestId).intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  console.log(`Intent: ${intake.interpreted_intent}`);
  const esc = intake.brain?.escalation;
  const brainModel = intake.brain?.model && intake.brain.model !== 'claude-code-cli' ? ` · model: ${intake.brain.model}` : '';
  const escNote = esc ? ` · escalated ${esc.from}→${esc.to} (${esc.reason})` : '';
  console.log(`Brain: ${intake.brain?.source || 'heuristic'}${brainModel}${escNote}${intake.brain?.fallback_reason ? ` (fallback: ${intake.brain.fallback_reason})` : ''}`);
  console.log(`Work type: ${intake.work_type}`);
  console.log(`Difficulty: ${intake.difficulty || 'unknown'} | Scope: ${intake.scope || 'unknown'}`);
  console.log(`Workflow: ${intake.recommended_workflow}`);
  console.log(`Risk: ${intake.risk}`);
  console.log(`Confidence: ${intake.confidence}`);
  console.log(`Missing info: ${intake.missing_info.join(', ') || 'none'}`);
  console.log(`Next: ${intake.next_best_action}`);
}

function cmdContextPack(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = saveContextPack(root, requestId);
  console.log(result.markdown);
}

function cmdGateCheck(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const gates = evaluateGates(root, requestId, config);
  console.log(`Gate check — ${requestId}\n`);
  for (const [name, gate] of Object.entries(gates.gates)) {
    console.log(`${statusIcon(gate.status)} ${name}: ${gate.status} — ${gate.reason}`);
  }
  console.log(`\nClose allowed: ${gates.close_allowed ? 'yes' : 'no'}`);
  if (gates.close_blockers.length) console.log(`\nBlockers:\n${bullet(gates.close_blockers)}`);
}

function cmdHealth() {
  const health = projectHealth(root);
  console.log(`Project Health: ${health.score}/100\n`);
  for (const check of health.checks) console.log(`${check.ok ? '✓' : '✕'} ${check.message}`);
}

function cmdStateDoctor() {
  const result = runStateDoctor(root);
  console.log(`State Doctor: ${result.status}`);
  if (result.issues.length) for (const issue of result.issues) console.log(`- ${issue.message} Fix: ${issue.fix}`);
}

function cmdProjectBootstrap(argv, config) {
  const result = bootstrapProject(root, config, { dryRun: argv.includes('--dry-run') });
  console.log(`Project bootstrap: ${result.status}`);
  if (result.changed.length) console.log(`Changed: ${result.changed.join(', ')}`);
  else console.log('Changed: none');
  if (result.warnings.length) console.log(`Warnings:
${bullet(result.warnings)}`);
  console.log(`Git initialized: ${result.git.initialized ? 'yes' : 'no'}`);
  console.log(`Initial commit created: ${result.git.initial_commit_created ? 'yes' : 'no'}`);
}

function cmdBranchStatus(argv) {
  const requestId = argv[0] || getActiveRequestId(root, null);
  const result = gitWorkflowStatus(root, requestId || null);
  console.log(JSON.stringify(result, null, 2));
}

function cmdFixIntake(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const paths = requestPaths(root, requestId);
  const req = loadRequest(root, requestId);
  if (!req) throw new Error(`Request not found: ${requestId}`);
  let intake = readJson(paths.intake, null);
  if (!intake) {
    intake = analyzeAsk(req.raw_user_ask || req.title, requestId, config);
    writeJson(paths.intake, intake);
  }
  saveQuestions(root, intake);
  saveImprovedSpec(root, intake);
  const judgment = saveJudgment(root, intake, config);
  saveRoutingDecision(root, intake, judgment);
  saveRiskRegister(root, intake);
  saveImpactAnalysis(root, intake);
  routeTools(root, intake);
  const epic = saveEpicDecomposition(root, intake);
  if (epic) appendEvent(root, 'EPIC_PROPOSED', { request_id: requestId, epic_id: epic.id, slices: epic.suggested_reqs.length });
  saveContextPack(root, requestId);
  evaluateGates(root, requestId, config, { skipFakeScan: true });
  console.log(`Intake repaired for ${requestId}.`);
}

function cmdAutoIterate(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const result = autoIterate(root, requestId, config);
  console.log(JSON.stringify(result, null, 2));
}

function cmdEvidence(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = generateEvidencePack(root, requestId);
  console.log(result.markdown);
}

function cmdLearn(argv) {
  const apply = argv.includes('--apply');
  const requestId = resolveRequestId(argv.find((x) => !x.startsWith('--')) || null);
  const result = generateLearning(root, requestId, { apply });
  console.log(result.markdown);
  if (result.proposal) console.log(`\nImprovement proposal created: ${result.proposal.path}`);
}

function cmdQuality(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = runQualityReview(root, requestId);
  console.log(result.markdown);
}

function cmdFunnelReview(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = runFunnelReview(root, requestId);
  console.log(result.markdown);
}

function cmdFakeDataScan(config) {
  const result = scanFakeData(root, config);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'failed') process.exitCode = 2;
}

function cmdDesignBrief(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = createDesignBrief(root, requestId);
  console.log(`Design brief: ${result.path}`);
}

function cmdDesignGenerate(argv, config) {
  const requestId = resolveRequestId(argv.find((x) => !x.startsWith('--') && !/^option-[a-z]$|^[a-z]$/i.test(x)) || null);
  const singleIndex = argv.indexOf('--single');
  const optionIndex = argv.indexOf('--option');
  const singleOption = singleIndex >= 0 ? argv[singleIndex + 1] : (optionIndex >= 0 ? argv[optionIndex + 1] : null);
  const result = generateDesignPromptPack(root, requestId, config, { confirm: argv.includes('--confirm'), singleOption, missingOnly: argv.includes('--missing-only'), continueMode: argv.includes('--continue'), allOptions: argv.includes('--all'), noFallback: argv.includes('--no-fallback') });
  console.log(`Provider: ${result.provider.name} (${result.provider.kind})`);
  if (result.manifest.fallback_from) console.log(`Fallback: primary provider ${result.manifest.fallback_from} produced no artifacts; used ${result.provider.name}.`);
  console.log(`Prompt pack: ${result.prompt_file}`);
  console.log(`Manifest: ${requestPaths(root, requestId).designManifest}`);
  console.log(`Status: ${result.manifest.status}`);
  if (result.manifest.note) console.log(`Note: ${result.manifest.note}`);
  const ready = (result.manifest.options || []).filter((item) => item.artifacts_exist).length;
  if (ready) console.log(`Artifacts ready: ${ready}/${(result.manifest.options || []).length}`);
}

function cmdDesignDoctor(config) {
  const report = designDoctor(root, config);
  console.log(`Design pipeline: ${report.status === 'ok' ? 'OK' : 'ATTENTION REQUIRED'}`);
  console.log(`Provider: ${report.provider} (${report.kind}) | strategy: ${report.strategy}`);
  for (const check of report.checks) {
    const icon = check.status === 'ok' ? '✔' : check.status === 'fail' ? '✖' : check.status === 'warning' ? '⚠' : 'ℹ';
    console.log(`${icon} ${check.id}: ${check.detail}`);
  }
  console.log(`Predicted behavior: ${report.predicted_behavior}`);
  writeJson(aiPath(root, 'designs', 'manifests', 'design-doctor.json'), report);
  console.log(`Report: .ai/designs/manifests/design-doctor.json`);
}

function cmdDesignImport(argv) {
  const requestId = resolveRequestId(null);
  const [desktop, mobile] = argv;
  const result = importDesign(root, requestId, desktop, mobile);
  console.log(`Imported design option: ${result.option.id}`);
}

function cmdDesignPreview(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = designPreview(root, requestId);
  console.log(JSON.stringify(result, null, 2));
}

function cmdDesignApprove(argv, config) {
  const option = argv[0];
  if (!option) throw new Error('Usage: npm run ai -- design-approve <option-id>');
  const requestId = resolveRequestId(argv[1] || null);
  const result = approveDesign(root, requestId, option);
  saveContextPack(root, requestId);
  evaluateGates(root, requestId, config);
  console.log(`Approved design: ${result.approved.approved_design}`);
  console.log(`Normalized from: ${result.normalized_from}`);
}

function cmdDesignProvider(argv, config) {
  const action = argv[0] || 'status';
  if (action === 'status') {
    console.log(`Default design provider: ${config.design?.default_provider || 'manual-import'}`);
    console.log(`Design quality: ${config.design?.quality || 'production-mock'}`);
    console.log(`Design creativity: ${config.design?.creativity || 'creative-director'}`);
    console.log(`Artifact verification: ${config.design?.verify_provider_artifacts !== false ? 'enabled' : 'disabled'}`);
    return;
  }
  if (action === 'set') {
    const provider = argv[1];
    if (!provider) throw new Error('Usage: npm run ai -- design-provider set <provider>');
    config.design.default_provider = provider;
    writeJson(aiPath(root, 'config.json'), config);
    console.log(`Design provider set to ${provider}`);
    return;
  }
  throw new Error(`Unknown design-provider action: ${action}`);
}

function cmdVisualReview(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const result = runVisualReview(root, requestId);
  evaluateGates(root, requestId, config);
  console.log(result.markdown);
}

function cmdVisualAccept(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const result = acceptVisual(root, requestId);
  // v5.1.2: acceptance criteria persisted during cycle predate this visual
  // acceptance — visual-dependent criteria evaluated as failed back then.
  // Re-evaluate NOW so gate-check reads the truth, not a stale snapshot.
  evaluateAcceptance(root, requestId);
  const gates = evaluateGates(root, requestId, config);
  if (gates.close_allowed) {
    updateRequest(root, requestId, { status: 'done', next_best_action: 'learn' });
    appendEvent(root, 'REQ_CLOSED', { request_id: requestId });
  } else {
    updateRequest(root, requestId, { status: 'visual_accepted', next_best_action: 'resolve remaining blockers' });
  }
  console.log(`Visual accepted for ${result.request_id}. Close allowed: ${gates.close_allowed ? 'yes' : 'no'}`);
}

function cmdScreenshotImport(argv, config) {
  const screenshot = argv[0];
  if (!screenshot) throw new Error('Usage: npm run ai -- screenshot-import "path"');
  const requestId = resolveRequestId(argv[1] || null);
  runVisualReview(root, requestId, { screenshot });
  evaluateGates(root, requestId, config);
  console.log(`Screenshot recorded in visual review for ${requestId}: ${screenshot}`);
}

function cmdComponentPlan(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const result = generateComponentPlan(root, requestId, config);
  console.log(`Component plan: ${result.path}`);
  console.log(`Components: ${result.components.length}`);
}

async function cmdResearchWeb(argv, config) {
  const query = argv.join(' ').trim();
  if (!query) throw new Error('Usage: npm run ai -- research-web "query"');
  const result = await runWebResearch(root, query, config);
  console.log(`Research provider: ${result.provider}`);
  console.log(`Status: ${result.status}`);
  console.log(`JSON: ${result.json_file}`);
  console.log(`Markdown: ${result.md_file}`);
  if (result.error) console.log(`Error: ${result.error}`);
  else console.log(`Results: ${result.results.length}`);
}

async function cmdDesignResearch(argv, config) {
  const requestId = resolveRequestId(argv[0] && /^REQ-\d{3,}$/.test(argv[0]) ? argv[0] : null);
  const intake = readJson(requestPaths(root, requestId).intake, null) || {};
  const result = await runDesignResearch(root, requestId, intake, config);
  console.log(`Design research: ${result.md_file}`);
  console.log(`Queries: ${result.queries.length}`);
  console.log(`Patterns: ${result.distilled_patterns.length}`);
}

function cmdMcp(argv) {
  const action = argv[0] || 'status';
  if (action === 'status') return console.log(JSON.stringify(mcpStatus(root), null, 2));
  if (action === 'list') {
    const tools = listMcpTools(root);
    for (const tool of tools) console.log(`${tool.enabled ? '✓' : '✕'} ${tool.name} [${tool.risk}] — ${(tool.capabilities || []).join(', ')}`);
    return;
  }
  if (action === 'enable' || action === 'disable') {
    const tool = argv[1];
    if (!tool) throw new Error(`Usage: npm run ai -- mcp ${action} <tool-name>`);
    const updated = setMcpToolEnabled(root, tool, action === 'enable');
    console.log(`MCP tool ${updated.name} ${updated.enabled ? 'enabled' : 'disabled'}.`);
    return;
  }
  if (action === 'doctor') {
    const result = mcpDoctor(root);
    console.log(`MCP Doctor: ${result.status}`);
    console.log(`Tools: ${result.total_tools} | Enabled: ${result.enabled_tools}`);
    if (result.issues.length) for (const issue of result.issues) console.log(`- [${issue.severity}] ${issue.tool}: ${issue.message}`);
    return;
  }
  throw new Error(`Unknown mcp action: ${action}`);
}


function cmdStandards(argv, config) {
  const action = argv[0] || 'status';
  if (action === 'init') {
    const profile = argv[1] || config.standards?.quality_profile || 'production';
    const result = initStandards(root, config, profile);
    console.log(`Standards initialized with profile: ${result.profile}`);
    return;
  }
  const status = standardsStatus(root);
  console.log(`Standards: ${status.exists ? 'initialized' : 'missing'}`);
  console.log(`Profile: ${status.profile}`);
  for (const file of status.files) console.log(`${file.exists ? '✓' : '✕'} ${file.name}`);
}

function cmdQualityProfile(argv, config) {
  const action = argv[0] || 'status';
  if (action === 'set') {
    const profile = argv[1];
    if (!profile) throw new Error('Usage: npm run ai -- quality-profile set prototype|mvp|production|enterprise');
    config.standards.quality_profile = profile;
    const result = setQualityProfile(root, profile, config);
    writeJson(aiPath(root, 'config.json'), config);
    console.log(`Quality profile set to ${result.profile}`);
    return;
  }
  console.log(`Quality profile: ${config.standards?.quality_profile || 'production'}`);
}

function cmdDesignQuality(argv, config) {
  const action = argv[0] || 'status';
  if (action === 'set') {
    const value = argv[1];
    if (!value) throw new Error('Usage: npm run ai -- design-quality set wireframe|concept|premium|production-mock');
    config.design.quality = value;
    writeJson(aiPath(root, 'config.json'), config);
    console.log(`Design quality set to ${value}`);
    return;
  }
  console.log(`Design quality: ${config.design?.quality || 'production-mock'}`);
}

function cmdDesignCreativity(argv, config) {
  const action = argv[0] || 'status';
  if (action === 'set') {
    const value = argv[1];
    if (!value) throw new Error('Usage: npm run ai -- design-creativity set strict|demo|creative|creative-director');
    config.design.creativity = value;
    writeJson(aiPath(root, 'config.json'), config);
    console.log(`Design creativity set to ${value}`);
    return;
  }
  console.log(`Design creativity: ${config.design?.creativity || 'creative-director'}`);
}

function cmdDesignCostPreview(argv, config) {
  const countArg = flagValue(argv, '--images');
  const preview = designCostPreview(config, countArg || 6);
  console.log('Design cost preview');
  console.log(`Provider: ${preview.provider}`);
  console.log(`Model: ${preview.model}`);
  console.log(`Quality: ${preview.quality}`);
  console.log(`Images: ${preview.image_count}`);
  console.log(`Estimated cost: ~$${preview.estimated_cost_usd.toFixed(2)}`);
  console.log(preview.note);
  console.log('Run design-generate --confirm to spend provider credits/API billing.');
}


function cmdOverrideWorkflow(argv, config) {
  const requestId = /^REQ-\d{3,}$/.test(argv[0] || '') ? argv.shift() : resolveRequestId(null);
  const workflow = argv[0];
  if (!workflow) throw new Error('Usage: npm run ai -- override-workflow [REQ-XXX] <workflow>');
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const reasonIndex = argv.indexOf('--reason');
  const reason = reasonIndex >= 0 ? argv.slice(reasonIndex + 1).join(' ') : 'Manual workflow override by user.';
  intake.recommended_workflow = workflow;
  intake.workflow = workflow;
  if (workflow !== 'product-epic-decomposition') {
    intake.requires_decomposition = false;
    intake.should_implement_now = true;
  }
  // Overriding to a non-design workflow must clear the design-first gate —
  // otherwise the cycle keeps demanding an approved design even after the
  // human explicitly chose direct-patch.
  if (workflow === 'direct-patch-with-validation' || workflow === 'contract-first' || workflow === 'diagnose-fix-validate') {
    intake.design_first_required = false;
  }
  intake.workflow_override = { workflow, reason, at: new Date().toISOString() };
  writeJson(paths.intake, intake);
  updateRequest(root, requestId, { workflow, status: 'implementation_ready', next_best_action: 'preview then approve execution' });
  saveContextPack(root, requestId);
  if (exists(paths.contract)) saveExecutionContract(root, requestId);
  appendEvent(root, 'WORKFLOW_OVERRIDDEN', { request_id: requestId, workflow, reason });
  console.log(`Workflow for ${requestId} set to ${workflow}.`);
}

function cmdDesignScore(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const manifest = readJson(requestPaths(root, requestId).designManifest, null);
  if (!manifest) throw new Error(`Missing design manifest for ${requestId}`);
  const options = manifest.options || [];
  const scored = options.map((option) => ({
    option: option.id,
    score: option.artifacts_exist ? (manifest.provider === 'gpt-image' ? 92 : manifest.provider === 'wireframe-mock' ? 58 : 70) : 20,
    notes: option.artifacts_exist ? 'Artifacts exist. Human visual review still required.' : 'Missing artifacts.'
  }));
  const md = ['# Design Score — ' + requestId, '', ...scored.map((s) => `- ${s.option}: ${s.score}/100 — ${s.notes}`)].join('\n');
  writeText(aiPath(root, 'designs', 'scores', `${requestId}-design-score.md`), md);
  console.log(md);
}

function cmdProductScan(argv, config) {
  console.log(JSON.stringify(productScan(root), null, 2));
}

async function cmdProposeFeatures(argv, config) {
  console.log('Scanning codebase and consulting the brain for high-value next steps...');
  const result = await proposeFeaturesWithBrain(root, config, {});
  console.log('');
  console.log(`Source: ${result.source}${result.provider ? ` (${result.provider})` : ''}`);
  if (result.source !== 'brain') {
    console.log('⚠️  Brain unavailable — these are deterministic fallback proposals from measured weaknesses.');
    console.log('   Run `npm run ai -- brain-doctor` and restore Claude for richer, prioritized recommendations.');
  }
  console.log('');
  console.log(readText(aiPath(root, 'autonomy', 'proposals', 'feature-proposals.md'), JSON.stringify(result, null, 2)));
}

async function cmdCreateReqFromProposal(argv, config) {
  const id = argv[0];
  if (!id) throw new Error('Usage: npm run ai -- create-req-from-proposal PROP-001');
  const payload = readJson(aiPath(root, 'autonomy', 'proposals', 'feature-proposals.json'), null);
  if (!payload) throw new Error('No proposals found. Run `propose-features` first.');
  const item = (payload.proposals || []).find((p) => p.id === id);
  if (!item) throw new Error(`Proposal not found: ${id}. Run propose-features first.`);
  // Feed the proposal through the real brain pipeline so it gets full intake.
  const ask = item.rationale ? `${item.title}. ${item.rationale}` : item.title;
  console.log(`Creating a REQ from ${id} via the brain pipeline...`);
  const { requestId, intake } = await runAskPipeline(ask, config, {}, { created_from_proposal: id });
  appendEvent(root, 'REQ_CREATED_FROM_PROPOSAL', { request_id: requestId, proposal_id: id });
  console.log(`Created ${requestId} from ${id}: ${item.title}`);
  console.log(`Work type: ${intake.work_type} | Risk: ${intake.risk} | Workflow: ${intake.recommended_workflow}`);
  console.log(`Next: ${intake.next_best_action}`);
}

function cmdAutonomousCycle(argv, config) {
  const modeIndex = argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? argv[modeIndex + 1] : undefined;
  const result = autonomousCycle(root, config, { mode });
  console.log(`Cycle: ${result.cycle_id}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Status: ${result.status}`);
  console.log(`Next: ${result.next_action}`);
  console.log(`Actions: ${result.actions.join(', ')}`);
}

function cmdFrontendReview(argv) { const result = runFrontendReview(root, resolveRequestId(argv[0])); console.log(result.markdown); }
function cmdBackendReview(argv) { const result = runBackendReview(root, resolveRequestId(argv[0])); console.log(result.markdown); }
function cmdProductReview(argv) { const result = runProductReview(root, resolveRequestId(argv[0])); console.log(result.markdown); }
function cmdSecurityReview(argv) { const result = runSecurityReview(root, resolveRequestId(argv[0])); console.log(result.markdown); }
function cmdArchitectureReview(argv) { const result = runArchitectureReview(root, resolveRequestId(argv[0])); console.log(result.markdown); }

function cmdApiContract(argv) {
  const result = generateApiContract(root, resolveRequestId(argv[0]));
  console.log(`API contract: ${result.path}`);
  console.log(JSON.stringify(result.contract, null, 2));
}

function cmdAdr(argv) {
  const title = argv[0] || 'Architecture decision';
  const decision = argv.slice(1).join(' ') || 'Decision generated by AI Code Factory.';
  const result = generateAdr(root, title, decision);
  console.log(`ADR created: ${result.path}`);
}

function cmdDashboard(argv, config) {
  const portArgIndex = argv.indexOf('--port');
  const port = portArgIndex >= 0 ? Number(argv[portArgIndex + 1]) : config.dashboard?.port;
  startDashboard(root, { port });
}

// --------------------------------------------------------------------------
// Evolution commands
// --------------------------------------------------------------------------

function cmdHistory(argv) {
  const limitIndex = argv.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) : 50;
  const result = historyTimeline(root, { limit });
  if (!result.count) return console.log('No history yet. Events are recorded as you use the harness.');
  console.log(`History — last ${result.count} events\n`);
  for (const line of result.lines) console.log(line);
}



// ── v5.3 verb layer: start → continue → review → accept ─────────────────────
// Four verbs cover the daily 90%. Everything else remains available by name.

function cmdGuide(config) {
  const g = buildGuide(root, config);
  console.log(renderGuide(g));
}

function cmdReview(argv, config) {
  const requestId = resolveRequestId(argv[0]);
  const packet = buildReviewPacket(root, requestId, config);
  console.log(renderReviewPacket(packet));
}

function cmdAccept(argv, config) {
  const requestId = resolveRequestId(argv.find((a) => !a.startsWith('--')) || null);
  // accept = "I looked at it and it's right": visual-accept + resume the cycle
  // (validate → gates → merge) in one verb.
  cmdVisualAccept([requestId], config);
  const req = loadRequest(root, requestId);
  if (req?.status === 'done') return; // visual-accept already closed it
  console.log('');
  cmdCycle([requestId], config);
}

// ── v5.0 commands ────────────────────────────────────────────────────────────

function cmdProgress(argv) {
  const requestId = resolveRequestId(argv[0]);
  const text = readProgress(root, requestId, 12000);
  console.log(text || `No progress recorded yet for ${requestId}. It fills automatically as cycle runs.`);
}

function cmdStats(config) {
  const stats = buildStats(root, config);
  console.log(renderStats(stats));
}

function cmdHooks(config, argv = []) {
  if (argv[0] === 'init') {
    const scaffolded = scaffoldHooks(root);
    console.log(`Hooks scaffolded at ${scaffolded.dir}`);
    console.log(`Edit ${scaffolded.sample} and rename it (drop ".example") to activate.`);
    console.log(`Available points: ${scaffolded.points.join(', ')}`);
    return;
  }
  const hooks = listHooks(root, config);
  if (!hooks.length) {
    console.log('No hooks defined. Create .ai/hooks/<name>.js for any of: ' + HOOK_POINTS.join(', '));
    console.log('Semantics: pre_* hooks with non-zero exit BLOCK the stage; post_* hooks never block.');
    console.log('Payload: JSON on stdin and in env ACF_HOOK_PAYLOAD.');
    return;
  }
  for (const h of hooks) console.log(`- ${h.name}: ${h.script ? h.script : 'configured via config.hooks'}`);
}



// v5.1 `setup` — one-command onboarding for NEW and EXISTING projects alike.
// One harness that adapts beats two harnesses to maintain: the difference
// between a fresh create-next-app and a 3-year-old repo is detected, not
// configured.
function cmdSetup(argv, config) {
  const rootDir = getProjectRoot();
  const pkg = readJsonSafe(path.join(rootDir, 'package.json'), null);
  const srcExists = exists(path.join(rootDir, 'src')) || exists(path.join(rootDir, 'app'));
  const isExisting = Boolean(pkg && srcExists);
  console.log(`AI Code Factory setup — detected: ${isExisting ? 'EXISTING project' : 'new/empty project'}${pkg?.name ? ` (${pkg.name})` : ''}`);

  console.log('\n[1/6] init — .ai workspace');
  ensureAiWorkspace(rootDir);
  console.log('  ✔ workspace ready');

  console.log('[2/6] project-bootstrap — validation scripts + git baseline');
  const boot = bootstrapProject(rootDir, loadConfig(rootDir));
  console.log(`  ✔ ${boot.changes?.length ? `changed: ${boot.changes.join(', ')}` : 'nothing to add'}`);

  console.log('[3/6] repo-map — token-efficient code skeleton');
  if (isExisting) {
    const { map, estimated_tokens } = saveRepoMap(rootDir);
    console.log(`  ✔ ${map.stats.files} files mapped → ~${estimated_tokens} tokens (${map.framework.join(', ') || 'framework pending'})`);
  } else {
    console.log('  ○ skipped (no source yet) — run `repo-map` after your first feature');
  }

  console.log('[4/6] agents-md — AGENTS.md / CLAUDE.md from live knowledge');
  syncAgentsMd(rootDir);
  console.log('  ✔ synced (managed block; your sections preserved)');

  console.log('[5/6] git-policy — knowledge versioned, runtime noise ignored');
  const policy = applyGitPolicy(rootDir, loadConfig(rootDir));
  console.log(`  ✔ mode ${policy.mode}, ${policy.lines_managed} runtime path(s) ignored`);

  console.log('[6/6] brain-eval — golden set seed');
  const seeded = seedGoldenSet(rootDir);
  console.log(`  ✔ .ai/golden ready (${seeded.created} case(s) added)`);

  console.log(`\nSetup complete. Next:`);
  console.log('  npm run ai -- doctor              # verify brain/executors on this machine');
  console.log('');
  console.log('The daily flow (4 verbs):');
  console.log('  start "tu pedido"  →  continue  →  review  →  accept');
  console.log('Lost at any point? Run `npm run ai --` with no command: it always tells you the next step.');
  if (isExisting) console.log('  Tip: add project rules in .ai/standards/rules.json — they become blocking gates via det-gates.');
}



function cmdRepoMap() {
  const root = getProjectRoot();
  const { map, estimated_tokens } = saveRepoMap(root);
  console.log(`Repo map generated: ${map.stats.files} files → ~${estimated_tokens} tokens (${map.framework.join(', ') || 'framework unknown'}).`);
  console.log(`- .ai/project-map.json`);
  console.log(`- .ai/context-cache/repo-map.md (injected into context packs automatically)`);
}

function cmdDetGates(argv, config) {
  const root = getProjectRoot();
  const requestId = argv[0];
  if (!requestId) return console.log('Usage: det-gates <REQ-ID> [--base <branch>]');
  const baseIdx = argv.indexOf('--base');
  const result = runDeterministicGates(root, requestId, config, { base: baseIdx >= 0 ? argv[baseIdx + 1] : null });
  console.log(`Deterministic gates for ${requestId}: ${result.passed ? 'PASSED' : 'FAILED'} (${result.failed_count} error(s), ${result.warning_count} warning(s)) on ${result.files_reviewed.length} changed file(s).`);
  for (const c of result.checks.filter((x) => !x.passed)) console.log(`  ${c.severity === 'error' ? '✕' : '⚠'} ${c.id}: ${c.detail}`);
  if (result.passed && !result.warning_count) console.log('  ✔ migration gate, standards rules and installed scanners are clean.');
}

function cmdPlaybooks(argv) {
  const root = getProjectRoot();
  const sub = argv[0] || 'list';
  if (sub === 'list') {
    const items = listPlaybooks(root);
    if (!items.length) return console.log('No playbooks yet. Close a REQ successfully and run: playbooks record <REQ-ID>');
    for (const pb of items) console.log(`- ${pb.id} [${pb.work_type}] uses:${pb.uses || 0} — ${pb.ask_summary.slice(0, 70)}`);
    return;
  }
  if (sub === 'record') {
    const requestId = argv[1];
    if (!requestId) return console.log('Usage: playbooks record <REQ-ID> [--force]');
    const pb = recordPlaybook(root, requestId, { requireClosed: !argv.includes('--force') });
    return console.log(`Playbook recorded: ${pb.id} (from ${requestId}). Future similar asks will reuse this proven plan.`);
  }
  if (sub === 'match') {
    const ask = argv.slice(1).join(' ');
    if (!ask) return console.log('Usage: playbooks match "<ask>"');
    const match = matchPlaybook(root, ask, { recordUse: false });
    if (match.matched) return console.log(`Matched: ${match.best.playbook.id} (score ${match.best.score}). This plan will be injected into the brain context.`);
    return console.log(`No match above threshold. Candidates: ${match.candidates.map((c) => `${c.id}:${c.score}`).join(', ') || 'none'}`);
  }
  console.log('Usage: playbooks list|record <REQ-ID>|match "<ask>"');
}

function cmdAgentsMd(argv) {
  const root = getProjectRoot();
  const sub = argv[0] || 'sync';
  if (sub !== 'sync') return console.log('Usage: agents-md sync');
  const result = syncAgentsMd(root);
  for (const w of result.written) console.log(`✔ ${w.file} refreshed (${w.chars} chars). Managed block updated; your custom sections were preserved.`);
}

async function cmdBrainEval(argv, config) {
  const root = getProjectRoot();
  if (argv[0] === 'init') {
    const seeded = seedGoldenSet(root);
    return console.log(`Golden set ready at .ai/golden/ (${seeded.created} case(s) added). Add real asks from your projects — they are the ones worth protecting.`);
  }
  const report = await runBrainEval(root, config, { useBrain: argv.includes('--brain') });
  if (!report.total) return console.log(report.note);
  console.log(`Brain eval (${report.mode}): ${report.passed}/${report.total} passed — accuracy ${(report.accuracy * 100).toFixed(0)}%.`);
  for (const r of report.results.filter((x) => !x.passed)) {
    console.log(`  ✕ ${r.id}: ${r.ask}`);
    for (const m of r.mismatches) console.log(`     ${m.field}: expected ${m.expected}, got ${m.actual}`);
  }
}

function cmdGitPolicy(argv, config) {
  const root = getProjectRoot();
  const sub = argv[0] || 'status';
  if (sub === 'apply') {
    const result = applyGitPolicy(root, config);
    return console.log(`Git policy applied (mode: ${result.mode}, ${result.lines_managed} runtime path(s) ignored). Knowledge stays versioned; noise stays out of git status.`);
  }
  const status = gitPolicyStatus(root, config);
  console.log(`Git .ai policy: ${status.mode} — managed block ${status.managed_block_present ? 'present' : 'NOT applied yet (run git-policy apply)'}.`);
  console.log(status.note);
}

function cmdCostReport(argv, config) {
  const root = getProjectRoot();
  const requestId = argv[0];
  if (!requestId) return console.log('Usage: cost-report <REQ-ID>');
  const report = buildCostReport(root, requestId, config);
  console.log(report.markdown);
  console.log(`\nSaved: ${report.file}`);
}

function cmdLessons() {
  const result = lessonsSummary(root);
  console.log(result.lessons);
  if (result.compiled) {
    console.log('\n--- Compiled knowledge ---\n');
    console.log(result.compiled.slice(0, 2000));
  }
}

function cmdEvolution() {
  const result = evolutionSummary(root);
  console.log('Evolution Summary\n');
  console.log(`Events: ${result.total_events}`);
  console.log(`Requests: ${result.total_requests} (${result.closed_requests} closed)`);
  console.log(`Executions: ${result.total_executions} | Failures: ${result.total_failures}`);
  console.log(`Execution success rate: ${result.execution_success_rate ?? 'n/a'}%`);
  for (const req of result.requests) {
    console.log(`- ${req.request_id}: ${req.closed ? 'closed' : 'open'} | exec ${req.executions} | fail ${req.failures}${req.visual_accepted ? ' | visual ok' : ''}`);
  }
}

function cmdCompileMemory() {
  const result = compileMemory(root);
  console.log(`Compiled knowledge written to ${result.path}\n`);
  console.log(result.markdown.slice(0, 2500));
}

function cmdFeedback(argv) {
  const text = argv.join(' ').trim();
  const entry = recordFeedback(root, text);
  console.log(`Feedback recorded as ${entry.id}. Run mine-feedback to turn feedback into candidate rules.`);
}

function cmdMineFeedback() {
  const result = mineFeedback(root);
  if (!result.mined) return console.log(result.message);
  console.log(`Mined ${result.mined} feedback entries into ${result.rules.length} candidate rules.`);
  for (const rule of result.rules) console.log(`- [${rule.kind}] ${rule.rule}`);
  console.log(`\nProposal: ${result.proposal}`);
  console.log('Preference rules were added to .ai/knowledge/user-preferences.json. Gate/process rules require approval via playbook-upgrade.');
}

function cmdReplay(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = replayRequest(root, requestId);
  console.log(result.markdown);
}

function cmdCounterfactual(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = counterfactualReview(root, requestId);
  console.log(result.markdown);
}

function cmdRootCause(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = rootCauseAnalysis(root, requestId);
  console.log(result.markdown);
}

function cmdClassifyFailures(argv) {
  const requestId = resolveRequestId(argv[0]);
  console.log(JSON.stringify(classifyFailures(root, requestId), null, 2));
}

function cmdDecisionQuality(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = decisionQuality(root, requestId);
  console.log(`Decision Quality — ${requestId}: ${result.score}/10\n`);
  for (const dim of result.dimensions) console.log(`- ${dim.name}: ${dim.score}/10 — ${dim.reason}`);
}

function cmdConfidenceCalibration() {
  console.log(JSON.stringify(calibrateConfidence(root), null, 2));
}

function cmdCalibrateAutonomy(argv) {
  const result = calibrateAutonomy(root, { apply: argv.includes('--apply') });
  console.log(`Autonomy calibration: ${result.status}`);
  console.log(`Current level: ${result.current_level} | Recommended: ${result.recommended_level}`);
  if (result.reason) console.log(result.reason);
  if (result.message) console.log(result.message);
  if (result.recommended_level !== result.current_level && !result.applied) console.log('Apply with: npm run ai -- calibrate-autonomy --apply');
  if (result.applied) console.log('Applied.');
}

function cmdAutonomy(argv) {
  const preset = argv[0];
  if (!preset) {
    const state = loadState(root);
    return console.log(`Autonomy level: ${state.autonomy_level}. Presets: safe (2) | balanced (3) | autonomous (5).`);
  }
  const result = setAutonomyPreset(root, preset);
  console.log(`Autonomy set to ${result.preset} (level ${result.level}).`);
}

function cmdDna(argv) {
  const dnaFile = aiPath(root, 'project-dna.json');
  const dna = readJson(dnaFile, null);
  if (argv[0] === 'edit') return console.log(`Edit the file directly: ${dnaFile}`);
  console.log(JSON.stringify(dna, null, 2));
}

function cmdPlaybookUpgrade(argv) {
  if (argv[0] === 'versions') {
    const versions = listPlaybookVersions(root);
    return console.log(versions.length ? versions.join('\n') : 'No playbook versions yet.');
  }
  const result = playbookUpgrade(root, { apply: argv.includes('--apply') });
  if (result.status === 'no_changes') return console.log(result.message);
  console.log(`Playbook upgrade ${result.applied ? 'APPLIED' : 'proposed'}:`);
  for (const p of result.proposals) {
    console.log(`\n${p.playbook}:`);
    for (const a of p.additions) console.log(`  - ${a}`);
  }
  console.log(`\nProposal file: ${result.proposal_file}`);
  if (!result.applied) console.log('Apply with: npm run ai -- playbook-upgrade --apply');
}

function cmdDistillSkill(argv) {
  const requestId = resolveRequestId(argv[0]);
  const result = distillSkill(root, requestId);
  console.log(`Skill distilled: ${result.path}\n`);
  console.log(result.markdown.slice(0, 1500));
}

function cmdSkills() {
  const skills = listSkills(root);
  console.log(skills.length ? skills.map((s) => `- .ai/skills/${s}`).join('\n') : 'No skills distilled yet. Use: npm run ai -- distill-skill REQ-XXX');
}

function cmdPatterns() {
  const result = buildPatterns(root);
  console.log(result.patterns.length ? `Patterns updated:\n${result.patterns.map((p) => `- ${p}`).join('\n')}` : 'No backlog data to extract patterns from yet.');
}

function cmdLockConstraint(argv) {
  const patternIndex = argv.indexOf('--pattern');
  const pattern = patternIndex >= 0 ? argv[patternIndex + 1] : null;
  const text = argv.filter((a, i) => !(i === patternIndex || i === patternIndex + 1)).join(' ').trim();
  if (!text) throw new Error('Usage: npm run ai -- lock-constraint "..." [--pattern <regex>]');
  const constraint = lockConstraint(root, text, { pattern });
  console.log(`Locked constraint ${constraint.id}: ${constraint.text}`);
  if (constraint.pattern) console.log(`Enforced against source files with pattern: ${constraint.pattern}`);
  console.log('This constraint is now injected into every executor contract and checked by gates.');
}

function cmdUnlockConstraint(argv) {
  const id = argv[0];
  if (!id) throw new Error('Usage: npm run ai -- unlock-constraint <LC-XXX>');
  const result = unlockConstraint(root, id);
  console.log(result.removed ? `Removed ${id}.` : `Constraint not found: ${id}`);
}

function cmdConstraints(argv, config) {
  if (argv[0] === 'check') return console.log(JSON.stringify(checkConstraints(root, config), null, 2));
  const constraints = listConstraints(root);
  if (!constraints.length) return console.log('No locked constraints. Add one with: npm run ai -- lock-constraint "..."');
  for (const c of constraints) console.log(`${c.id} | ${c.scope} | ${c.text}${c.pattern ? ` | pattern: ${c.pattern}` : ''}`);
}

function cmdArchitectureDrift() {
  const result = detectArchitectureDrift(root);
  console.log(`Architecture drift: ${result.status}`);
  if (!result.dna_present) console.log('Note: project-dna.json missing; using defaults.');
  for (const issue of result.issues) console.log(`- ${issue.message}\n  Fix: ${issue.fix}`);
}

function cmdTestGaps() {
  const result = findTestGaps(root);
  console.log(`Test gaps: ${result.status}`);
  console.log(`Source files: ${result.source_files} | Test files: ${result.test_files} | Estimated reference coverage: ${result.estimated_reference_coverage ?? 'n/a'}%`);
  if (result.gaps.length) {
    console.log('\nFiles without test references:');
    for (const gap of result.gaps.slice(0, 30)) console.log(`- ${gap}`);
    if (result.gaps.length > 30) console.log(`...and ${result.gaps.length - 30} more`);
  }
  console.log(`\n${result.note}`);
}

function cmdSuggestNext() {
  const result = suggestNext(root);
  console.log('Suggested next actions:\n');
  for (const sug of result.suggestions) console.log(`[${sug.priority}] (${sug.kind}) ${sug.title}\n    ${sug.detail}`);
}

function cmdImproveSelf() {
  const memory = compileMemory(root);
  const upgrade = playbookUpgrade(root, { apply: false });
  const suggestions = suggestNext(root);
  console.log('Self-improvement cycle (proposal-only):\n');
  console.log(`1. Knowledge compiled: ${memory.path}`);
  console.log(`2. Playbook upgrade: ${upgrade.status === 'no_changes' ? 'no changes suggested' : `proposed → ${upgrade.proposal_file}`}`);
  console.log('3. Suggested next actions:');
  for (const sug of suggestions.suggestions.slice(0, 5)) console.log(`   [${sug.priority}] ${sug.title}`);
  console.log('\nNothing was applied automatically. Apply playbook changes with --apply where offered.');
}

function cmdExperiment(argv) {
  const action = argv[0] || 'list';
  if (action === 'list') {
    const experiments = listExperiments(root);
    if (!experiments.length) return console.log('No experiments. Start one: npm run ai -- experiment start "context-pack-size" A,B');
    for (const e of experiments) console.log(`${e.id} | ${e.status} | ${e.name} | variants: ${e.variants.map((v) => `${v.name}(${v.measurements.length})`).join(', ')}`);
    return;
  }
  if (action === 'start') {
    const name = argv[1];
    const variants = (argv[2] || 'A,B').split(',').map((v) => v.trim()).filter(Boolean);
    const experiment = startExperiment(root, name, variants);
    return console.log(`Started ${experiment.id}: ${experiment.name} with variants ${variants.join(', ')}`);
  }
  if (action === 'measure') {
    // experiment measure EXP-001 A --tokens 1200 --quality 8 --errors 0 --time 90000 --corrections 1
    const [_, experimentId, variant] = argv;
    const measurement = {
      tokens: flagValue(argv, '--tokens'),
      quality: flagValue(argv, '--quality'),
      errors: flagValue(argv, '--errors'),
      time_ms: flagValue(argv, '--time'),
      manual_corrections: flagValue(argv, '--corrections'),
      request_id: flagValue(argv, '--req', true)
    };
    recordMeasurement(root, experimentId, variant, measurement);
    return console.log(`Measurement recorded for ${experimentId} variant ${variant}.`);
  }
  if (action === 'compare') {
    const result = compareExperiment(root, argv[1]);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`Unknown experiment action: ${action}. Use list | start | measure | compare.`);
}


function parseBrainFlags(argv) {
  const rest = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--brain-depth' || arg === '--depth') {
      options.depth = argv[++i];
      continue;
    }
    if (arg === '--provider' || arg === '--brain-provider') {
      options.provider = argv[++i];
      continue;
    }
    if (arg === '--strategy' || arg === '--reasoning-strategy') {
      options.strategy = argv[++i];
      continue;
    }
    rest.push(arg);
  }
  return { rest, options };
}

function flagValue(argv, flag, asString = false) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return asString ? argv[index + 1] : Number(argv[index + 1]);
}

function cmdSystemDoctor(config) {
  const report = runSystemDoctor(root, config);
  const head = report.status === 'ok' ? 'HEALTHY' : report.status === 'warnings' ? 'OK (warnings)' : 'ATTENTION REQUIRED';
  console.log(`AI Code Factory v${report.version} — system doctor: ${head}`);
  console.log(`Summary: ${report.summary.ok} ok · ${report.summary.warnings} warnings · ${report.summary.failed} failed · ${report.summary.info} info\n`);
  for (const section of report.sections) {
    console.log(`[${section.name}]`);
    for (const c of section.checks) {
      const icon = c.status === 'ok' ? '✔' : c.status === 'fail' ? '✖' : c.status === 'warning' ? '⚠' : 'ℹ';
      console.log(`  ${icon} ${c.id}: ${c.detail}`);
      if (c.fix && c.status !== 'ok' && c.status !== 'info') console.log(`      → ${c.fix}`);
    }
  }
  writeJson(aiPath(root, 'reasoning', 'logs', 'system-doctor.json'), report);
  console.log(`\nReport: .ai/reasoning/logs/system-doctor.json`);
  if (report.status === 'attention_required') process.exitCode = 1;
}

function cmdDoctorSyntax() {
  const files = listFilesRecursive(path.join(root, 'src'), { extensions: ['.js'], ignoreDirs: ['node_modules'] })
    .concat(listFilesRecursive(path.join(root, 'tests'), { extensions: ['.js'], ignoreDirs: ['node_modules'] }));
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', shell: false });
    if (result.status !== 0) failures.push({ file, stderr: result.stderr });
  }
  if (failures.length) {
    for (const failure of failures) console.error(`${failure.file}\n${failure.stderr}`);
    throw new Error(`${failures.length} syntax errors`);
  }
  console.log(`Syntax OK (${files.length} files checked).`);
}

function resolveRequestId(explicit = null, required = true) {
  const id = getActiveRequestId(root, explicit);
  if (!id && required) throw new Error('No active request. Run ask first or pass REQ id.');
  return id;
}

function makeTitle(ask) {
  return ask.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled request';
}

function printBacklog(backlog) {
  if (!backlog.length) return console.log('No backlog items yet. Run: npm run ai -- ask "..."');
  for (const req of backlog) console.log(`${req.id} | ${req.status} | ${req.work_type} | ${req.title}`);
}

function printHelp() {
  console.log(`AI Code Factory v${VERSION} — Reliable Brain, Token Economy & Deterministic Quality OS

THE DAILY FLOW (4 verbs cover 90% of usage):
  npm run ai --                          # no command = guide: where you are + exact next step
  npm run ai -- start "tu pedido"        # create a requirement (alias of ask)
  npm run ai -- continue                 # run/resume the cycle: branch → implement → validate → gates → merge
  npm run ai -- review                   # human decision packet: diff, gates, acceptance, cost
  npm run ai -- accept                   # "I looked at it, it's right": visual-accept + merge

v5.1 highlights:
  npm run ai -- setup                    # one-command onboarding — adapts to new OR existing projects
  npm run ai -- progress [REQ]           # what's already done (resume-safe; embedded in executor contracts)
  npm run ai -- stats                    # queryable observability: blockers, token spend, activity
  npm run ai -- hooks                    # lifecycle hooks: pre_execute/post_execute/post_validate/pre_merge
  npm run ai -- repo-map                 # token-efficient code skeleton for the brain (~90% cheaper context)
  npm run ai -- det-gates <REQ>          # zero-token quality gates: migration gate, executable standards, semgrep/ast-grep
  npm run ai -- playbooks list|record|match   # reuse proven plans instead of re-exploring (token savings compound)
  npm run ai -- agents-md sync           # generate AGENTS.md/CLAUDE.md from live project knowledge
  npm run ai -- brain-eval [init|--brain]     # golden-set regression tests for the harness intelligence
  npm run ai -- git-policy apply         # hybrid .ai versioning: knowledge in git, runtime noise ignored
  npm run ai -- cost-report <REQ>        # per-REQ, per-stage token/cost breakdown

Simple commands:
  npm run ai -- ask "..."
  npm run ai -- next
  npm run ai -- cycle              # run the full engineering cycle (brain-decided, gate-respecting)
  npm run ai -- preview
  npm run ai -- approve-dry-run
  npm run ai -- approve
  npm run ai -- status
  npm run ai -- doctor              # full system health (brain/design/state/executor/version)

Control commands:
  questions | answer | why | intake-preview | ask-preview | brain-status | brain-doctor | brain-route | next-step | executor-status | cost-status | context-pack | gate-check | validate | recover-execution
  quality | funnel-review | fake-data-scan | evidence | learn
  health | doctor | state-doctor | project-bootstrap | branch-status | fix-intake | auto-iterate

Autonomy & recommendations:
  cycle [--approved|--dry-run|--no-auto-fix]  — run the full engineering cycle for a REQ
  propose-features                            — brain analyzes the code and recommends features/weaknesses
  create-req-from-proposal PROP-NNN           — turn a proposal into a brain-analyzed REQ
  product-scan | autonomous-cycle | run-loop

Design-first commands:
  design-brief | design-generate [--all|--missing-only|--single <opt>|--confirm|--no-fallback] | design-import | design-preview | design-approve
  design-provider | design-doctor | visual-review | visual-accept | screenshot-import | component-plan
  research-web | design-research | mcp status|list|enable|disable|doctor
  standards init|status | quality-profile set <profile> | design-quality set <mode> | design-creativity set <mode>
  design-cost-preview | design-score | component-plan | override-workflow

Evolution commands:
  history | lessons | evolution | compile-memory
  feedback "..." | mine-feedback
  replay [REQ] | counterfactual [REQ] | root-cause [REQ] | classify-failures [REQ]
  decision-quality [REQ] | confidence-calibration | calibrate-autonomy [--apply]
  autonomy safe|balanced|autonomous | dna | playbook-upgrade [--apply]
  distill-skill [REQ] | skills | patterns
  lock-constraint "..." [--pattern <regex>] | unlock-constraint <id> | constraints [check]
  product-scan | propose-features | create-req-from-proposal | autonomous-cycle | run-loop
  frontend-review | backend-review | product-review | security-review | architecture-review | api-contract | adr
  architecture-drift | test-gaps | suggest-next | improve-self
  experiment start|measure|compare|list

Command Center:
  dashboard | ui
`);
}
