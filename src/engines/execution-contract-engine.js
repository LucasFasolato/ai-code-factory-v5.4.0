import { exists, readJson, readJsonSafe, readText, writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { bullet } from '../core/format.js';
import { listConstraints } from './constraint-engine.js';
import { budgetText } from '../core/prompt-budget.js';

// The context pack is the largest, most variable part of a contract. Cap the
// portion embedded in the contract; the full pack always remains on disk for
// the executor to read if it needs more.
const CONTRACT_CONTEXT_BUDGET = 12000;

export function buildExecutionContract(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const contextPack = budgetText(readText(paths.contextPack, 'Context pack missing.'), CONTRACT_CONTEXT_BUDGET);
  const approvedDesign = exists(paths.approvedDesign) ? readJsonSafe(paths.approvedDesign, null) : null;
  const designAssets = readText(paths.approvedDesign ? paths.approvedDesign.replace('approved-design.json', 'implementation-assets.md') : '', '');
  const allowedFiles = allowedFilesFor(intake);
  const lockedConstraints = listConstraints(root);
  const epicWarning = intake.requires_decomposition || intake.work_type === 'product_epic';
  const contract = `# Executor Contract — ${requestId}\n\n` +
    `## Goal\n\n${intake.interpreted_intent}\n\n` +
    `## Orchestrator Decision\n\n- Work type: ${intake.work_type}\n- Difficulty: ${intake.difficulty || 'unknown'}\n- Scope: ${intake.scope || 'unknown'}\n- Risk: ${intake.risk}\n- Workflow: ${intake.recommended_workflow}\n- Implement now: ${intake.should_implement_now ? 'yes' : 'no'}\n- Requires decomposition: ${intake.requires_decomposition ? 'yes' : 'no'}\n\n` +
    `## Source of Truth\n\n` +
    `${approvedDesign ? bullet([paths.approvedDesign, approvedDesign.desktop_image, approvedDesign.mobile_image].filter(Boolean)) : '- Context Pack\n- Improved Spec\n- User Answers / Clarifications inside context pack'}\n\n` +
    `## Approved Design Policy\n\n${approvedDesignPolicy(intake, approvedDesign)}\n\n` +
    `${approvedDesign ? `## Production Design Fidelity Requirements\n\n${designFidelityRequirements(approvedDesign, designAssets)}\n\n` : ''}` +
    `${approvedDesign && /before|after|antes|despu/i.test((intake.raw_user_ask || '') + ' ' + intake.interpreted_intent) ? `## Required Before/After Interaction\n\n${beforeAfterInteractionRequirements()}\n\n` : ''}` +
    `${approvedDesign && intake.work_type === 'frontend_visual' ? `## Required Frontend Component Architecture\n\n${frontendComponentArchitecture()}\n\n` : ''}` +
    `## Allowed Files\n\n${bullet(allowedFiles)}\n\n` +
    `## Allowed Files Strategy\n\n${intake.allowed_files_strategy || 'files directly related to the request only'}\n\n` +
    `## Forbidden\n\n${bullet(effectiveForbidden(intake))}\n\n` +
    `## Locked Constraints (non-negotiable)\n\n${lockedConstraints.length ? bullet(lockedConstraints.map((c) => `[${c.id}] ${c.text}`)) : '- none'}\n\n` +
    `## Required Commands\n\n- npm run lint\n- npm run typecheck\n- npm test\n- npm run build\n\n` +
    `## Context Pack\n\n${contextPack}\n\n` +
    `## Expected Output\n\n` +
    `${epicWarning ? '- Do not implement the full epic in this executor run. Stop and request/prepare a child REQ.\n' : '- Implement the requested change within allowed scope.\n'}` +
    `- Report files changed.\n- Do not claim done unless validation passed.\n`;
  return { request_id: requestId, markdown: contract };
}

export function saveExecutionContract(root, requestId) {
  const result = buildExecutionContract(root, requestId);
  writeText(requestPaths(root, requestId).contract, result.markdown);
  return result;
}


function designFidelityRequirements(approvedDesign, designAssets) {
  return [
    '- Implement from the approved production mockup, not from a generic layout.',
    '- Do not replace approved images with flat gradients, abstract blocks, blank rectangles or low-fidelity placeholders.',
    '- If generated image assets exist under .ai/designs/generated/assets, copy/use them under public/images/landing or reference them through implementation-safe assets.',
    '- If only full-page mockups exist, use them as visual reference and create realistic synthetic section imagery in public/images/landing; do not leave visual slots empty.',
    '- Use explicit placeholder labels only for missing real contact data: Email pendiente, Teléfono pendiente, Ubicación pendiente.',
    '- Preserve approved visual hierarchy, typography scale, CTA prominence, before/after gallery intent and mobile composition.',
    '- Add or preserve reduced-motion-safe microinteractions only when simple and dependency-free.',
    designAssets ? `
## Design Asset Notes

${designAssets}` : ''
  ].filter(Boolean).join('\n');
}


function beforeAfterInteractionRequirements() {
  return [
    '- Implement a real interactive BeforeAfterSlider component; decorative-only handles are not acceptable.',
    '- The slider must support mouse/pointer drag and touch drag on mobile.',
    '- The visible split must change as the user drags; do not use a static split image only.',
    '- Use real before/after image assets from public/images/landing when available.',
    '- The hero compare and project gallery compare cards should reuse the same component or a shared primitive.',
    '- Include an accessible label/role or range input fallback; keyboard support is preferred.',
    '- Respect prefers-reduced-motion; interaction must remain usable without animation.'
  ].join('\n');
}

function frontendComponentArchitecture() {
  return [
    '- Do not put the entire landing in a single giant page.tsx.',
    '- Create focused components under src/components/landing/ when possible.',
    '- Recommended components: Header, HeroBeforeAfter, BeforeAfterSlider, ServicesSection, ProjectGallery, ContactCTA, SiteFooter.',
    '- Keep demo content in a small content object or src/lib/landing-content.ts when practical.',
    '- page.tsx should orchestrate sections and remain readable.',
    '- Avoid adding heavy dependencies; prefer CSS and React state unless a dependency is explicitly justified.'
  ].join('\n');
}

export function allowedFilesFor(intake) {
  if (Array.isArray(intake.allowed_files) && intake.allowed_files.length) return intake.allowed_files;
  if (intake.work_type === 'frontend_visual') return ['src/app/page.tsx', 'src/app/globals.css', 'src/app/layout.tsx', 'src/components/**', 'tests/**', 'public/**'];
  if (intake.work_type === 'backend_api') return ['src/**/*.ts', 'test/**/*.ts', 'tests/**/*.ts'];
  if (intake.work_type === 'fullstack_feature') return ['apps/**', 'src/**', 'packages/**', 'tests/**'];
  if (intake.work_type === 'product_epic') return ['.ai/epics/**', '.ai/reasoning/**', '.ai/backlog/**'];
  if (intake.work_type === 'small_change') return ['src/**', 'app/**', 'pages/**', 'components/**', 'tests/**'];
  return ['files directly related to the request'];
}

// The contract is a legal document for the executor: it must reflect the
// CURRENT decision, not the decision history. After override-workflow cleared
// design-first, a stale "do not implement visual work without approved design"
// left in Forbidden made Codex (correctly!) refuse to implement — exit 0,
// no files, honest-success guard tripped. Contradictory contracts are bugs.
function approvedDesignPolicy(intake, approvedDesign) {
  if (approvedDesign) return `The approved design is ${approvedDesign.approved_design}. Do not use another design option.`;
  if (intake.design_first_required) return 'No approved design yet. Design-first IS required for this REQ: do not implement visual UI until a design is approved.';
  return 'Design-first is NOT required for this REQ (direct-patch workflow). Implement following the project conventions and the visual direction stated in User Answers.';
}

function effectiveForbidden(intake) {
  const rules = Array.isArray(intake.must_not_do) ? intake.must_not_do : [];
  if (intake.design_first_required) return rules;
  const designRule = /implement.*(frontend )?visual.*without approved design|visual work without approved design/i;
  return rules.filter((r) => !designRule.test(String(r)));
}
