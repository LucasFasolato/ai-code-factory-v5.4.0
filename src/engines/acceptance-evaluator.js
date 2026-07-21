import path from 'node:path';
import { exists, listFilesRecursive, readJson, readJsonSafe, readText, writeJson } from '../core/fs.js';
import { aiPath, requestPaths } from '../core/paths.js';
import { nowIso } from '../core/format.js';

export function evaluateAcceptance(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  const spec = readJsonSafe(paths.specJson, { criteria: [] });
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const implementationText = collectImplementationText(root, intake);
  const approvedDesign = exists(paths.approvedDesign);
  const visualAccepted = exists(paths.visualReview) && /visual acceptance:\s*accepted/i.test(readText(paths.visualReview, ''));
  const answers = readText(paths.answersMd, '');
  const criteria = (spec.criteria || []).map((text) => evaluateCriterion(text, { intake, implementationText, approvedDesign, visualAccepted, answers }));
  const failed = criteria.filter((item) => item.status === 'failed');
  const warnings = criteria.filter((item) => item.status === 'warning');
  const closeAllowed = failed.length === 0 && (!intake.needs_visual_acceptance || visualAccepted) && !(intake.requires_decomposition || intake.work_type === 'product_epic');
  const result = {
    request_id: requestId,
    summary: `${criteria.length - failed.length}/${criteria.length} passed${warnings.length ? `, ${warnings.length} warning` : ''}`,
    criteria,
    close_allowed: closeAllowed,
    generated_at: nowIso()
  };
  writeJson(paths.acceptance, result);
  return result;
}

function evaluateCriterion(text, ctx) {
  const lower = text.toLowerCase();
  if (/decomposed into a roadmap|decompose|epic/.test(lower)) {
    return (ctx.intake.suggested_reqs || []).length || ctx.intake.requires_decomposition
      ? { text, status: 'passed', evidence: 'Epic decomposition exists or is required by intake.' }
      : { text, status: 'failed', evidence: 'No decomposition found for an epic-sized request.' };
  }
  if (/no executor run implements the whole epic|whole epic/.test(lower)) {
    return { text, status: ctx.intake.work_type === 'product_epic' ? 'failed' : 'passed', evidence: ctx.intake.work_type === 'product_epic' ? 'Product epic cannot close as implementation.' : 'Not an epic implementation.' };
  }
  if (/fake real-world|fake contact|fake data/.test(lower)) {
    return { text, status: 'passed', evidence: 'Fake data scanner is evaluated by a dedicated gate.' };
  }
  if (/api contract|request\/response|contract is documented/.test(lower)) {
    if (/contract|contrato|response|request|endpoint|dto/i.test(`${ctx.answers}\n${ctx.intake.raw_user_ask}`)) return { text, status: 'passed', evidence: 'API contract appears in ask or user answers.' };
    return { text, status: 'warning', evidence: 'API contract should be confirmed in answers or spec.' };
  }
  if (/approved visual design/.test(lower)) {
    return ctx.approvedDesign
      ? { text, status: 'passed', evidence: 'Approved design artifact exists.' }
      : { text, status: 'failed', evidence: 'Approved design artifact is missing.' };
  }
  if (/visual evidence|visual acceptance/.test(lower)) {
    return ctx.visualAccepted
      ? { text, status: 'passed', evidence: 'Visual acceptance recorded.' }
      : { text, status: 'failed', evidence: 'Visual acceptance not recorded yet.' };
  }
  if (/before\/after gallery|before\/after|antes|despu[eé]s|6 to 8/.test(lower)) {
    const interaction = evaluateBeforeAfterInteraction(ctx.implementationText);
    if (interaction.status === 'passed') return { text, status: 'passed', evidence: interaction.evidence };
    if (interaction.status === 'failed') return { text, status: 'failed', evidence: interaction.evidence };
    return { text, status: 'warning', evidence: interaction.evidence };
  }
  if (/hero/.test(lower)) return evidenceByKeyword(text, ctx.implementationText, /hero|headline|h1/i, 'Hero/headline marker');
  if (/cta/.test(lower)) return evidenceByKeyword(text, ctx.implementationText, /cta|contacto|contact|button|bot[oó]n/i, 'CTA/contact/button marker');
  if (/responsive|mobile/.test(lower)) return { text, status: 'warning', evidence: 'Responsive/mobile requires visual or browser validation.' };
  if (/validation commands/.test(lower)) return { text, status: 'warning', evidence: 'Technical validation is evaluated by a dedicated gate.' };
  if (/evidence pack/.test(lower)) return { text, status: 'warning', evidence: 'Evidence pack generation is evaluated separately.' };
  return { text, status: 'passed', evidence: 'Criterion recorded; no automated contradiction found.' };
}


function evaluateBeforeAfterInteraction(implementationText) {
  const count = countOccurrences(implementationText, /before|after|antes|despu[eé]s|comparison|compare|galer|card/gi);
  const hasSliderName = /BeforeAfterSlider|compare-control|comparison-slider|before-after-slider/i.test(implementationText);
  const hasInteractiveLogic = /onPointer|onMouse|onTouch|clientX|pointermove|useState|input\s+type=["']range|role=["']slider/i.test(implementationText);
  const hasClip = /clip-path|width:\s*\$?\{?\s*position|style=\{\{[^}]*width|--split|object-position/i.test(implementationText);
  const hasImages = /<Image|next\/image|background-image|url\(/i.test(implementationText);
  if (count < 4) return { status: 'warning', evidence: `Only ${count} before/after/gallery related mentions found.` };
  if (!hasSliderName) return { status: 'failed', evidence: 'Before/after requested, but no explicit slider/component marker found.' };
  if (!hasInteractiveLogic) return { status: 'failed', evidence: 'Before/after slider appears decorative only: no pointer/touch/range/state interaction found.' };
  if (!hasClip) return { status: 'warning', evidence: 'Interactive logic found, but clipping/split implementation should be visually verified.' };
  if (!hasImages) return { status: 'warning', evidence: 'Before/after implementation found, but image usage should be visually verified.' };
  return { status: 'passed', evidence: 'Before/after slider markers, interactive logic, clipping and images found.' };
}

function evidenceByKeyword(text, implementationText, regex, label) {
  if (regex.test(implementationText)) return { text, status: 'passed', evidence: `${label} found.` };
  return { text, status: 'warning', evidence: `${label} not found in scanned text.` };
}

function collectImplementationText(root, intake) {
  const dna = readJsonSafe(aiPath(root, 'project-dna.json'), {});
  const dirs = new Set([...(dna?.expected_architecture?.source_dirs || []), 'src', 'app', 'pages', 'components', 'apps', 'packages']);
  const files = [];
  for (const dir of dirs) {
    files.push(...listFilesRecursive(path.join(root, dir), { extensions: ['.ts', '.tsx', '.js', '.jsx', '.css', '.html'], ignoreDirs: ['node_modules', '.git', '.ai', 'dist', 'build', '.next'] }));
  }
  return [...new Set(files)].slice(0, 120).map((file) => readText(file, '')).join('\n');
}

function countOccurrences(text, regex) {
  return (text.match(regex) || []).length;
}
