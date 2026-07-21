import path from 'node:path';

export function getProjectRoot(explicitRoot = null) {
  return path.resolve(explicitRoot || process.cwd());
}

export function aiPath(root, ...parts) {
  return path.join(root, '.ai', ...parts);
}

export function requestPaths(root, requestId) {
  return {
    backlog: aiPath(root, 'backlog', `${requestId}.json`),
    intake: aiPath(root, 'reasoning', 'intake', `${requestId}-intake-analysis.json`),
    questionsMd: aiPath(root, 'reasoning', 'questions', `${requestId}-questions.md`),
    questionsJson: aiPath(root, 'reasoning', 'questions', `${requestId}-questions.json`),
    answersMd: aiPath(root, 'reasoning', 'questions', `${requestId}-answers.md`),
    spec: aiPath(root, 'specs', `${requestId}-improved-spec.md`),
    specJson: aiPath(root, 'specs', `${requestId}-acceptance-criteria.json`),
    contextPack: aiPath(root, 'reasoning', 'context-packs', `${requestId}-context-pack.md`),
    decision: aiPath(root, 'reasoning', 'decisions', `${requestId}-routing.md`),
    judgment: aiPath(root, 'reasoning', 'judgment', `${requestId}-judgment.json`),
    gates: aiPath(root, 'reasoning', 'gates', `${requestId}-gates.json`),
    risks: aiPath(root, 'reasoning', 'risks', `${requestId}-risk-register.md`),
    impact: aiPath(root, 'reasoning', 'impact', `${requestId}-impact-analysis.md`),
    acceptance: aiPath(root, 'reasoning', 'acceptance', `${requestId}-acceptance-eval.json`),
    contract: aiPath(root, 'execution', 'contracts', `${requestId}-executor-contract.md`),
    validation: aiPath(root, 'execution', 'status', `${requestId}-validation.json`),
    executionStatus: aiPath(root, 'execution', 'status', `${requestId}-execution.json`),
    selfReview: aiPath(root, 'reasoning', 'reviews', `${requestId}-self-review.md`),
    codeReview: aiPath(root, 'reasoning', 'reviews', `${requestId}-code-review.md`),
    productReview: aiPath(root, 'reasoning', 'reviews', `${requestId}-product-review.md`),
    visualReview: aiPath(root, 'reasoning', 'reviews', `${requestId}-visual-review.md`),
    evidence: aiPath(root, 'evidence', 'packs', `${requestId}-evidence-pack.md`),
    learning: aiPath(root, 'memory', 'learnings', `${requestId}-learning.md`),
    designBrief: aiPath(root, 'designs', 'briefs', `${requestId}-design-brief.md`),
    designManifest: aiPath(root, 'designs', 'manifests', `${requestId}-designs.json`),
    approvedDesign: aiPath(root, 'designs', 'approved', `${requestId}-approved-design.json`),
    toolRouting: aiPath(root, 'mcp', 'tool-routing', `${requestId}-tool-routing.json`),
    brainSummary: aiPath(root, 'reasoning', 'brain', `${requestId}-brain-summary.md`),
    brainDecisionLog: aiPath(root, 'reasoning', 'brain', `${requestId}-decision-log.md`),
    brainContext: aiPath(root, 'reasoning', 'brain', `${requestId}-brain-context.json`),
    brainProviderTrace: aiPath(root, 'reasoning', 'brain', `${requestId}-provider-trace.json`),
    replay: aiPath(root, 'history', 'replays', `${requestId}-replay.md`),
    counterfactual: aiPath(root, 'history', 'replays', `${requestId}-counterfactual.md`),
    rootCause: aiPath(root, 'history', 'replays', `${requestId}-root-cause.md`),
    decisionQuality: aiPath(root, 'history', 'scores', `${requestId}-decision-quality.json`),
    failureClass: aiPath(root, 'history', 'failures', `${requestId}-failure-classification.json`),
    skill: aiPath(root, 'skills', `${requestId}-skill.md`)
  };
}
