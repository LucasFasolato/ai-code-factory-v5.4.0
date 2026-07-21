import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exists, readJson, readJsonSafe, readText, writeJson, writeText, copyFileSafe, ensureDir, safeRel } from '../core/fs.js';
import { aiPath, requestPaths } from '../core/paths.js';
import { nowIso } from '../core/format.js';
import { updateRequest } from '../core/state.js';
import { appendEvent } from '../core/events.js';
import { runCommand, commandExists } from '../core/command-runner.js';
import { buildExecutorEnv } from './executor-auth.js';

export function createDesignBrief(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const answers = readText(paths.answersMd, '').trim();
  const context = readText(paths.contextPack, '').trim();
  const mustInclude = [
    'Clear hero.',
    'Visible CTA.',
    'Strong hierarchy.',
    'Mobile usable layout.',
    'Professional footer.'
  ];
  if (/before|after|galer/i.test(intake.raw_user_ask || '')) mustInclude.push('Before/after gallery with 6 to 8 cases.');
  if (/servic/i.test(intake.raw_user_ask || '')) mustInclude.push('Service section with concise service cards.');
  const direction = deriveDirection(intake, answers);
  const md = [
    `# Design Brief — ${requestId}`,
    '',
    '## Intent',
    '',
    intake.interpreted_intent,
    '',
    '## Work Type',
    '',
    intake.work_type,
    '',
    '## Direction',
    '',
    direction,
    '',
    '## Must Include',
    '',
    ...mustInclude.map((item) => `- ${item}`),
    '',
    '## User Answers / Clarifications',
    '',
    answers || '- No explicit answers recorded yet. Use safe defaults and flag assumptions clearly.',
    '',
    '## Visual/Brand Assumptions',
    '',
    '- If no brand system exists, use a warm neutral, premium, sober palette.',
    '- If no logo exists, use text-only brand treatment.',
    '- If no photos exist, use explicit visual placeholders or neutral placeholder blocks.',
    '- Never invent contact data, metrics, legal claims or business facts.',
    '',
    '## Must Not Do',
    '',
    ...((intake.must_not_do || []).length ? intake.must_not_do : ['Do not invent business data.']).map((item) => `- ${item}`),
    '- Do not write code before the design is explicitly approved.',
    '',
    '## Missing Assets Policy',
    '',
    'Use explicit placeholders. Never invent real contact data, metrics or legal claims.',
    '',
    '## Context Notes',
    '',
    extractContextNotes(context)
  ].join('\n');
  writeText(paths.designBrief, md);
  updateRequest(root, requestId, { status: 'design_plan_ready', next_best_action: 'design-generate or design-import' });
  return { request_id: requestId, path: paths.designBrief, markdown: md };
}

export function generateDesignPromptPack(root, requestId, config = {}, options = {}) {
  const paths = requestPaths(root, requestId);
  if (!exists(paths.designBrief)) createDesignBrief(root, requestId);
  let providerConfig = resolveDesignProvider(config);
  const intake = readJson(paths.intake, null) || {};
  const context = readText(paths.contextPack, '').trim();
  const answers = readText(paths.answersMd, '').trim();
  const brief = readText(paths.designBrief, '').trim();
  const designResearch = readText(aiPath(root, 'research', `${requestId}-design-research.md`), '').trim();
  const promptFile = aiPath(root, 'designs', 'prompts', `${requestId}-design-prompt-pack.md`);
  const outputPlan = buildOutputPlan(root, requestId, providerConfig);
  const prompt = buildDesignPromptPack({ requestId, providerConfig, intake, brief, context, answers, outputPlan, designResearch });
  writeText(promptFile, prompt);

  let generation = { status: 'prompt_pack_ready', provider: providerConfig.name, options: [], note: 'No provider execution attempted.' };
  if (providerConfig.kind === 'wireframe-mock') {
    generation = runWireframeMockProvider(root, requestId, providerConfig, intake, outputPlan);
  } else if (providerConfig.kind === 'gpt-image-codex') {
    generation = runCodexGptImageProvider(root, requestId, providerConfig, config, { prompt, outputPlan, intake, brief, context, answers, designResearch, confirm: Boolean(options.confirm), singleOption: options.singleOption || null, missingOnly: Boolean(options.missingOnly), continueMode: Boolean(options.continueMode), allOptions: Boolean(options.allOptions) });
  } else if (providerConfig.kind === 'gpt-image-api') {
    generation = runGptImageProvider(root, requestId, providerConfig, { prompt, outputPlan, intake, brief, context, answers, designResearch, confirm: Boolean(options.confirm) });
  } else if (providerConfig.kind === 'external-command') {
    generation = runExternalCommandProvider(root, requestId, providerConfig, { prompt, outputPlan, intake, brief, context, answers });
  }

  // v4.5 honest fallback chain: if the active provider produced zero valid
  // artifacts, walk design.fallback_chain so the pipeline never dead-ends.
  const designConfig = config.design || {};
  const autoFallback = process.env.ACF_DESIGN_AUTO_FALLBACK
    ? process.env.ACF_DESIGN_AUTO_FALLBACK !== 'false'
    : designConfig.auto_fallback !== false;
  const producedSomething = (generation.options || []).some((item) => item.artifacts_exist);
  if (autoFallback && !producedSomething && !options.noFallback) {
    const chain = (designConfig.fallback_chain || ['gpt-image-codex', 'gpt-image-api', 'wireframe-mock'])
      .filter((name) => name !== providerConfig.name && (designConfig.providers?.[name]?.kind || name) !== providerConfig.kind);
    for (const fallbackName of chain) {
      const fallbackKind = designConfig.providers?.[fallbackName]?.kind || fallbackName;
      if (fallbackKind === 'gpt-image-codex' && !commandExists(process.env.ACF_DESIGN_CODEX_COMMAND || config.execution?.codex?.command || 'codex')) continue;
      if (fallbackKind === 'gpt-image-api') {
        // Never spend API billing silently: only fall back to the Images API
        // when the user passed --confirm and the key is present.
        const apiKeyEnv = process.env.ACF_DESIGN_API_KEY_ENV || designConfig.gpt_image?.api_key_env || 'OPENAI_API_KEY';
        if (!options.confirm || !process.env[apiKeyEnv]) continue;
      }
      const fallbackProvider = { ...resolveDesignProvider({ ...config, design: { ...designConfig, default_provider: fallbackName } }), name: fallbackName, kind: fallbackKind };
      const fallbackPlan = buildOutputPlan(root, requestId, fallbackProvider);
      let fallbackGeneration = null;
      if (fallbackKind === 'wireframe-mock') fallbackGeneration = runWireframeMockProvider(root, requestId, fallbackProvider, intake, fallbackPlan);
      else if (fallbackKind === 'gpt-image-codex') fallbackGeneration = runCodexGptImageProvider(root, requestId, fallbackProvider, config, { prompt, outputPlan: fallbackPlan, intake, brief, context, answers, designResearch, confirm: Boolean(options.confirm), allOptions: true });
      else if (fallbackKind === 'gpt-image-api') fallbackGeneration = runGptImageProvider(root, requestId, fallbackProvider, { prompt, outputPlan: fallbackPlan, intake, brief, context, answers, designResearch, confirm: Boolean(options.confirm) });
      if (fallbackGeneration && (fallbackGeneration.options || []).some((item) => item.artifacts_exist)) {
        appendEvent(root, 'DESIGN_FALLBACK', { request_id: requestId, from: providerConfig.name, to: fallbackName });
        fallbackGeneration.note = `Primary provider ${providerConfig.name} produced no valid artifacts; fell back to ${fallbackName}. ${fallbackGeneration.note || ''}`.trim();
        fallbackGeneration.fallback_from = providerConfig.name;
        generation = fallbackGeneration;
        providerConfig = fallbackProvider;
        Object.assign(outputPlan, fallbackPlan);
        break;
      }
    }
  }

  const manifest = buildManifestFromGeneration(root, requestId, providerConfig.name, outputPlan, generation, config.design || {});
  writeJson(paths.designManifest, manifest);
  const nextAction = manifest.status === 'generated' || manifest.status === 'design_ready'
    ? 'design-preview then design-approve'
    : 'design-import generated images or configure a provider';
  updateRequest(root, requestId, { status: manifest.status === 'generated' || manifest.status === 'design_ready' ? 'design_ready' : 'design_generation_ready', next_best_action: nextAction });
  appendEvent(root, 'DESIGN_GENERATED', { request_id: requestId, provider: providerConfig.name, status: manifest.status });
  return { request_id: requestId, prompt_file: promptFile, manifest, provider: providerConfig, generation };
}

export function importDesign(root, requestId, desktopImage, mobileImage = null) {
  if (!desktopImage) throw new Error('desktop image path is required');
  const paths = requestPaths(root, requestId);
  if (!exists(desktopImage)) throw new Error(`Desktop image not found: ${desktopImage}`);
  const safeDesktop = `${requestId}-imported-a-desktop${path.extname(desktopImage) || '.png'}`;
  const desktopTarget = aiPath(root, 'designs', 'imported', safeDesktop);
  copyFileSafe(desktopImage, desktopTarget);
  let mobileTarget = null;
  if (mobileImage) {
    if (!exists(mobileImage)) throw new Error(`Mobile image not found: ${mobileImage}`);
    const safeMobile = `${requestId}-imported-a-mobile${path.extname(mobileImage) || '.png'}`;
    mobileTarget = aiPath(root, 'designs', 'imported', safeMobile);
    copyFileSafe(mobileImage, mobileTarget);
  }
  const manifest = readJsonSafe(paths.designManifest, { request_id: requestId, provider: 'manual-import', options: [], recommended_option: null });
  const option = {
    id: `${requestId}-option-imported-a`,
    label: 'Imported A',
    desktop_image: rel(root, desktopTarget),
    mobile_image: mobileTarget ? rel(root, mobileTarget) : null,
    source: 'manual-import',
    artifacts_exist: true,
    created_at: nowIso()
  };
  manifest.options = [...(manifest.options || []).filter((item) => item.id !== option.id), option];
  manifest.provider = 'manual-import';
  manifest.recommended_option = manifest.recommended_option || option.id;
  manifest.updated_at = nowIso();
  manifest.status = 'design_ready';
  writeJson(paths.designManifest, manifest);
  updateRequest(root, requestId, { status: 'design_ready', next_best_action: 'design-approve option-imported-a' });
  appendEvent(root, 'DESIGN_IMPORTED', { request_id: requestId, option_id: option.id });
  return { request_id: requestId, option, manifest };
}

export function approveDesign(root, requestId, rawOptionId) {
  const paths = requestPaths(root, requestId);
  const manifest = readJson(paths.designManifest, null);
  if (!manifest) throw new Error(`Missing design manifest for ${requestId}. Run design-generate or design-import first.`);
  const normalized = normalizeDesignOptionId(rawOptionId, requestId, manifest);
  if (!normalized.ok) {
    const suggestions = normalized.suggestions.length ? ` Suggestions: ${normalized.suggestions.join(', ')}` : '';
    throw new Error(`Design option not found: ${rawOptionId}.${suggestions}`);
  }
  const option = normalized.option;
  if (option.artifacts_exist === false && !optionArtifactsExist(root, option)) {
    throw new Error(`Design artifacts missing for ${option.id}. Generate real images or import a design before approval.`);
  }
  const approved = {
    request_id: requestId,
    approved_design: option.id,
    provider: manifest.provider || option.source || 'unknown',
    desktop_image: option.desktop_image || null,
    mobile_image: option.mobile_image || null,
    approved_by_user: true,
    approved_at: nowIso(),
    raw_user_input: rawOptionId,
    notes: `User explicitly approved ${option.id}. Do not use another option even if manifest recommended a different one.`
  };
  writeJson(paths.approvedDesign, approved);
  updateRequest(root, requestId, { status: 'design_approved', next_best_action: 'preview implementation' });
  appendEvent(root, 'DESIGN_APPROVED', { request_id: requestId, approved_design: option.id, raw_user_input: rawOptionId });
  return { request_id: requestId, approved, normalized_from: rawOptionId };
}

export function normalizeDesignOptionId(rawOptionId, requestId, manifest) {
  const input = String(rawOptionId || '').trim();
  if (!input) return { ok: false, reason: 'empty option id', suggestions: optionIds(manifest) };
  const candidates = new Set();
  const lowerInput = input.toLowerCase().replace(/\\/g, '/');
  const basename = lowerInput.split('/').pop().replace(/\.(png|jpg|jpeg|webp|json|svg|html)$/i, '');
  const withoutDevice = basename.replace(/-(desktop|mobile)$/i, '');
  for (const value of [input, lowerInput, basename, withoutDevice]) {
    const cleaned = value.replace(/\.(png|jpg|jpeg|webp|json|svg|html)$/i, '').replace(/-(desktop|mobile)$/i, '');
    if (!cleaned) continue;
    candidates.add(cleaned.toLowerCase());
    if (/^option-[a-z0-9-]+$/i.test(cleaned)) candidates.add(`${requestId}-${cleaned}`.toLowerCase());
    if (/^imported-[a-z0-9-]+$/i.test(cleaned)) candidates.add(`${requestId}-option-${cleaned}`.toLowerCase());
  }
  const options = manifest.options || [];
  for (const option of options) {
    const ids = [option.id, option.label, option.desktop_image, option.mobile_image]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase().split('/').pop().replace(/\.(png|jpg|jpeg|webp|json|svg|html)$/i, '').replace(/-(desktop|mobile)$/i, ''));
    ids.push(String(option.id).toLowerCase());
    if (ids.some((id) => candidates.has(id))) return { ok: true, option, canonical_id: option.id, candidates: [...candidates], suggestions: [] };
  }
  return { ok: false, reason: 'not found', candidates: [...candidates], suggestions: suggestOptions([...candidates], options) };
}

export function designPreview(root, requestId) {
  const manifest = readJsonSafe(requestPaths(root, requestId).designManifest, null);
  if (!manifest) return { request_id: requestId, status: 'missing_manifest', options: [] };
  return { request_id: requestId, status: 'ok', manifest, options: manifest.options || [] };
}

function runWireframeMockProvider(root, requestId, providerConfig, intake, outputPlan) {
  ensureDir(aiPath(root, 'designs', 'generated'));
  const variants = [
    { key: 'a', label: 'Option A', theme: 'Warm editorial split hero', accent: '#9b7b59' },
    { key: 'b', label: 'Option B', theme: 'Service-first card layout', accent: '#6d7d73' },
    { key: 'c', label: 'Option C', theme: 'Gallery-led premium showcase', accent: '#7f6652' }
  ];
  const generated = [];
  for (const variant of variants) {
    const desktop = outputPlan[variant.key].desktop;
    const mobile = outputPlan[variant.key].mobile;
    writeText(desktop.abs, buildWireframeSvg({ width: 1440, height: 1800, variant, intake, requestId, mode: 'desktop' }));
    writeText(mobile.abs, buildWireframeSvg({ width: 430, height: 1700, variant, intake, requestId, mode: 'mobile' }));
    generated.push({
      id: `${requestId}-option-${variant.key}`,
      label: variant.label,
      desktop_image: desktop.rel,
      mobile_image: mobile.rel,
      artifacts_exist: true,
      source: providerConfig.name,
      created_at: nowIso()
    });
  }
  writeText(aiPath(root, 'designs', 'generated', `${requestId}-contact-sheet.html`), buildContactSheetHtml(requestId, generated));
  return { status: 'generated', provider: providerConfig.name, options: generated, note: 'Built-in wireframe mock provider generated SVG wireframes.' };
}



function runCodexGptImageProvider(root, requestId, providerConfig, config, context) {
  ensureDir(aiPath(root, 'designs', 'generated'));
  ensureDir(aiPath(root, 'designs', 'generated', 'assets'));
  const designConfig = config.design || {};
  const strategy = process.env.ACF_DESIGN_CODEX_STRATEGY || designConfig.codex_artifact_strategy || 'html-first';
  const renderer = detectHtmlRenderer(designConfig);
  const rasterizeEnabled = process.env.ACF_DESIGN_RASTERIZE_HTML
    ? process.env.ACF_DESIGN_RASTERIZE_HTML !== 'false'
    : designConfig.rasterize_html !== false;

  const allOutputTargets = Object.fromEntries(Object.entries(context.outputPlan).map(([key, pair]) => [key, {
    desktop: pair.desktop.rel,
    mobile: pair.mobile.rel
  }]));
  const selectedKeys = selectCodexDesignKeys(root, requestId, context.outputPlan, context, designConfig);
  const jobBase = {
    request_id: requestId,
    provider: providerConfig.name,
    provider_kind: providerConfig.kind,
    mode: context.allOptions ? 'all-options' : 'staged-single-option-first',
    artifact_strategy: strategy,
    output_dir: '.ai/designs/generated',
    all_output_targets: allOutputTargets,
    selected_options: selectedKeys,
    contact_sheet: `.ai/designs/generated/${requestId}-contact-sheet.html`,
    manifest: `.ai/designs/manifests/${requestId}-designs.json`,
    source_prompt_pack: `.ai/designs/prompts/${requestId}-design-prompt-pack.md`,
    constraints: [
      'Design stage only. Do not modify src, app, pages, components, package.json, tests or production code.',
      'Generate visual design artifacts only under .ai/designs/generated.',
      strategy === 'html-first'
        ? 'Create self-contained, production-quality HTML mockups (inline CSS, no external requests). The harness rasterizes them to PNG.'
        : 'Create real high-fidelity production mockup images, not wireframes or placeholder rectangles.',
      'If you cannot produce the requested artifacts, report honestly and do not create fake or empty files.'
    ],
    generated_at: nowIso()
  };

  const codex = providerConfig.codex || {};
  const command = process.env.ACF_DESIGN_CODEX_COMMAND || codex.command || config.execution?.codex?.command || 'codex';
  const baseArgs = parseArgs(process.env.ACF_DESIGN_CODEX_ARGS || codex.args || (config.execution?.codex?.args || ['exec', '--sandbox', 'workspace-write', '--config', 'approval_policy="never"', '-C']));
  const executorEnv = buildExecutorEnv({ execution: config.execution || {} });
  const canRun = commandExists(command);
  const stageResults = [];

  if (!canRun) {
    stageResults.push({ option: null, success: false, error: `Codex command not found: ${command}` });
  } else {
    for (const key of selectedKeys) {
      const pair = context.outputPlan[key];
      if (!pair) continue;
      const htmlTargets = {
        desktop: pair.desktop.rel.replace(/\.[a-z0-9]+$/i, '.html'),
        mobile: pair.mobile.rel.replace(/\.[a-z0-9]+$/i, '.html')
      };
      const stageJob = {
        ...jobBase,
        stage: `design-option-${key}`,
        output_targets: { [key]: allOutputTargets[key] },
        html_targets: strategy === 'html-first' ? { [key]: htmlTargets } : undefined,
        asset_targets: minimalImplementationAssetTargets(requestId),
        current_option: key,
        current_required_files: strategy === 'html-first'
          ? [htmlTargets.desktop, htmlTargets.mobile]
          : [allOutputTargets[key].desktop, allOutputTargets[key].mobile]
      };
      const jobFile = aiPath(root, 'designs', 'prompts', `${requestId}-codex-design-job-option-${key}.json`);
      const providerPromptFile = aiPath(root, 'designs', 'prompts', `${requestId}-codex-design-provider-option-${key}.md`);
      writeJson(jobFile, stageJob);
      const providerPrompt = buildCodexDesignProviderPrompt({ requestId, providerConfig, context, jobFile, optionKey: key, strategy, htmlTargets });
      writeText(providerPromptFile, providerPrompt);
      const requiredList = stageJob.current_required_files.join(' and ');
      const instruction = [
        'You are the AI Code Factory Design Provider Agent.',
        `Read the SHORT design provider prompt at: ${rel(root, providerPromptFile)}`,
        `Read the option job JSON at: ${rel(root, jobFile)}`,
        strategy === 'html-first'
          ? `Create ONLY option-${key} as two self-contained HTML mockups exactly at: ${requiredList}. Inline all CSS. No external network requests, no JS frameworks, no source-code edits.`
          : `Generate ONLY option-${key} desktop and mobile PNG files exactly at the specified paths.`,
        'Do not edit application/source files. Only write .ai/designs/generated artifacts and optional provider notes.',
        strategy === 'html-first'
          ? 'Finish only after both HTML files exist with real, polished mockup content.'
          : 'If image-generation tooling is unavailable, say so and stop.'
      ].join('\n');
      const args = buildCodexProviderArgs(baseArgs, root, instruction);
      const result = runCommand(command, args, {
        cwd: root,
        timeout: Number(process.env.ACF_DESIGN_CODEX_TIMEOUT_MS || providerConfig.timeout_ms || config.execution?.timeout_ms || 900000),
        env: executorEnv.env
      });

      // Resolve whatever Codex actually produced (html/png/svg) and rasterize HTML when possible.
      const rasterizations = [];
      for (const mode of ['desktop', 'mobile']) {
        const plannedAbs = pair[mode].abs;
        let resolved = resolveOptionArtifact(root, pair[mode].rel, designConfig);
        if (resolved.valid && resolved.kind === 'html' && rasterizeEnabled && renderer.available) {
          const dims = mode === 'desktop' ? { width: 1440, height: 2200 } : { width: 430, height: 1900 };
          const raster = rasterizeHtmlToPng(renderer.command, resolved.abs, plannedAbs, dims);
          rasterizations.push({ mode, renderer: renderer.command, ...raster });
          const recheck = resolveOptionArtifact(root, pair[mode].rel, designConfig);
          if (recheck.valid) resolved = recheck;
        }
      }
      const desktopArtifact = resolveOptionArtifact(root, pair.desktop.rel, designConfig);
      const mobileArtifact = resolveOptionArtifact(root, pair.mobile.rel, designConfig);
      const artifactsExist = desktopArtifact.valid && mobileArtifact.valid;
      const stage = {
        option: key,
        command,
        args,
        strategy,
        auth_mode: executorEnv.policy.mode,
        api_env_removed: executorEnv.removed,
        success: Boolean(result.success && artifactsExist),
        status: result.status,
        signal: result.signal,
        timed_out: Boolean(result.timed_out),
        error: result.error || null,
        stdout_preview: result.stdout_preview || '',
        stderr_preview: result.stderr_preview || '',
        artifacts_exist: artifactsExist,
        desktop: desktopArtifact.valid ? desktopArtifact.rel : pair.desktop.rel,
        mobile: mobileArtifact.valid ? mobileArtifact.rel : pair.mobile.rel,
        desktop_artifact: desktopArtifact,
        mobile_artifact: mobileArtifact,
        rasterizations,
        renderer: renderer.available ? renderer.command : null,
        provider_prompt_file: rel(root, providerPromptFile),
        job_file: rel(root, jobFile)
      };
      stageResults.push(stage);
      writeJson(aiPath(root, 'designs', 'manifests', `${requestId}-codex-provider-run-option-${key}.json`), stage);
      if (context.singleOption && artifactsExist) break;
    }
  }

  const stageSummary = {
    request_id: requestId,
    provider: providerConfig.name,
    kind: providerConfig.kind,
    strategy,
    renderer: renderer.available ? renderer.command : null,
    renderer_note: renderer.available ? null : renderer.note,
    selected_options: selectedKeys,
    generated_at: nowIso(),
    stages: stageResults
  };
  writeJson(aiPath(root, 'designs', 'manifests', `${requestId}-codex-provider-run.json`), stageSummary);
  writeImplementationAssetNotes(root, requestId);

  const options = collectGeneratedOptions(allOutputTargets, providerConfig.name, requestId, root, designConfig);
  const pngContactSheet = aiPath(root, 'designs', 'generated', `${requestId}-contact-sheet.png`);
  const htmlContactSheet = aiPath(root, 'designs', 'generated', `${requestId}-contact-sheet.html`);
  if (!exists(pngContactSheet) && !exists(htmlContactSheet)) writeText(htmlContactSheet, buildContactSheetHtml(requestId, options));
  const some = options.some((item) => item.artifacts_exist);
  const all = options.length > 0 && options.every((item) => item.artifacts_exist);
  const generatedCount = options.filter((item) => item.artifacts_exist).length;
  const attempted = selectedKeys.join(', ');
  const noRendererSuffix = !renderer.available && some ? ' (HTML mockups accepted; install Chrome/Chromium/Edge to also get PNG renders).' : '';
  return {
    status: all ? 'generated' : (some ? 'design_ready' : 'prompt_pack_ready'),
    provider: providerConfig.name,
    strategy,
    renderer: renderer.available ? renderer.command : null,
    options,
    contact_sheet: exists(pngContactSheet) ? `.ai/designs/generated/${requestId}-contact-sheet.png` : `.ai/designs/generated/${requestId}-contact-sheet.html`,
    note: all
      ? `Codex Design Provider generated all requested design artifacts.${noRendererSuffix}`
      : (some
        ? `Codex Design Provider generated ${generatedCount}/${options.length} option(s). Use design-generate --missing-only or --all to continue.${noRendererSuffix}`
        : `Codex Design Provider did not create valid artifacts for attempted option(s): ${attempted}. Run design-doctor for a full diagnosis, retry, use design-import, or rely on the automatic fallback chain.`),
    command_result: stageSummary,
    job_file: null,
    provider_prompt_file: null,
    stages: stageResults
  };
}

function selectCodexDesignKeys(root, requestId, outputPlan, context = {}, designConfig = {}) {
  const all = Object.keys(outputPlan || {}).filter(Boolean);
  if (!all.length) return ['a'];
  if (context.allOptions) return all;
  if (context.missingOnly || context.continueMode) {
    const missing = all.filter((key) => {
      const pair = outputPlan[key];
      return pair && !resolveOptionArtifact(root, pair.desktop.rel, designConfig).valid;
    });
    if (missing.length) return context.continueMode ? [missing[0]] : missing;
  }
  let requested = null;
  if (context.singleOption) requested = normalizeOptionKey(context.singleOption);
  if (!requested && process.env.ACF_DESIGN_CODEX_SINGLE_OPTION) requested = normalizeOptionKey(process.env.ACF_DESIGN_CODEX_SINGLE_OPTION);
  if (!requested) requested = normalizeOptionKey(designConfig.codex_default_option || 'a');
  return all.includes(requested) ? [requested] : ['a'];
}

function normalizeOptionKey(input) {
  const s = String(input || '').toLowerCase().trim();
  const m = s.match(/option-([a-z])|^([a-z])$/);
  return (m?.[1] || m?.[2] || 'a').slice(0, 1);
}

function minimalImplementationAssetTargets(requestId) {
  return {
    hero_before: `.ai/designs/generated/assets/${requestId}-hero-before.png`,
    hero_after: `.ai/designs/generated/assets/${requestId}-hero-after.png`,
    brand_wordmark: `.ai/designs/generated/assets/${requestId}-brand-wordmark.png`
  };
}


function buildImplementationAssetTargets(requestId) {
  const out = {
    hero_before: `.ai/designs/generated/assets/${requestId}-hero-before.png`,
    hero_after: `.ai/designs/generated/assets/${requestId}-hero-after.png`,
    brand_wordmark: `.ai/designs/generated/assets/${requestId}-brand-wordmark.png`
  };
  for (let i = 1; i <= 6; i += 1) {
    const n = String(i).padStart(2, '0');
    out[`case_${n}_before`] = `.ai/designs/generated/assets/${requestId}-case-${n}-before.png`;
    out[`case_${n}_after`] = `.ai/designs/generated/assets/${requestId}-case-${n}-after.png`;
  }
  return out;
}

function writeImplementationAssetNotes(root, requestId) {
  const assetsDir = aiPath(root, 'designs', 'generated', 'assets');
  const existing = [];
  if (exists(assetsDir)) {
    const files = fs.readdirSync(assetsDir).filter((name) => name.startsWith(requestId));
    for (const file of files) existing.push(`.ai/designs/generated/assets/${file}`);
  }
  const md = [
    `# Implementation Assets — ${requestId}`,
    '',
    existing.length ? '## Generated reusable assets' : '## No reusable assets generated yet',
    '',
    ...(existing.length ? existing.map((f) => `- ${f}`) : ['- Codex generated page mockups, but no separate reusable image asset pack was detected. Implementation must create or extract production-like demo assets under public/images/landing rather than using abstract gradients.']),
    '',
    '## Implementation rule',
    '',
    '- Never leave hero/gallery visual areas as blank boxes, abstract gradients, or placeholder blocks.',
    '- If no separate assets exist, create realistic demo image assets in public/images/landing based on the approved mockup direction.',
    '- Use explicit real-data placeholders only for contact data.'
  ].join('\n');
  writeText(aiPath(root, 'designs', 'approved', `${requestId}-implementation-assets.md`), md);
}

function runGptImageProvider(root, requestId, providerConfig, context) {
  const targets = Object.values(context.outputPlan).flatMap((item) => [item.desktop, item.mobile]);
  const estimated = designCostPreview(providerConfig, targets.length);
  const apiKey = process.env[providerConfig.api_key_env];
  writeJson(aiPath(root, 'designs', 'assets', `${requestId}-synthetic-assets.json`), buildSyntheticAssetManifest(requestId, providerConfig, context.intake));
  writeText(aiPath(root, 'designs', 'creative-direction', `${requestId}-creative-direction.md`), buildCreativeDirection(requestId, providerConfig, context));
  writeText(aiPath(root, 'designs', 'interactions', `${requestId}-interaction-plan.md`), buildInteractionPlan(requestId, context));
  writeText(aiPath(root, 'designs', 'motion', `${requestId}-motion-plan.md`), buildMotionPlan(requestId));
  if (providerConfig.require_confirm && !context.confirm) {
    return {
      status: 'prompt_pack_ready',
      provider: providerConfig.name,
      options: [],
      note: `GPT Image generation is ready but requires --confirm. Estimated ${targets.length} image(s), ~$${estimated.estimated_cost_usd.toFixed(2)}.`,
      cost_preview: estimated
    };
  }
  if (!apiKey) {
    return {
      status: 'prompt_pack_ready',
      provider: providerConfig.name,
      options: [],
      note: `Missing ${providerConfig.api_key_env}. Add it to .env or use manual-import/wireframe-mock.`,
      cost_preview: estimated
    };
  }
  const generated = [];
  const errors = [];
  for (const [key, pair] of Object.entries(context.outputPlan)) {
    const optionLabel = `Option ${key.toUpperCase()}`;
    const desktopPrompt = buildGptImagePrompt({ ...context, providerConfig, optionKey: key, optionLabel, mode: 'desktop' });
    const mobilePrompt = buildGptImagePrompt({ ...context, providerConfig, optionKey: key, optionLabel, mode: 'mobile' });
    try {
      generateImageFileSync(providerConfig, apiKey, desktopPrompt, providerConfig.desktop_size, pair.desktop.abs);
      generateImageFileSync(providerConfig, apiKey, mobilePrompt, providerConfig.mobile_size, pair.mobile.abs);
    } catch (error) {
      errors.push({ option: key, error: error.message || String(error) });
    }
    generated.push({
      id: `${requestId}-option-${key}`,
      label: optionLabel,
      desktop_image: pair.desktop.rel,
      mobile_image: pair.mobile.rel,
      artifacts_exist: validateDesignArtifact(pair.desktop.abs).valid && validateDesignArtifact(pair.mobile.abs).valid,
      source: providerConfig.name,
      created_at: nowIso()
    });
  }
  writeText(aiPath(root, 'designs', 'generated', `${requestId}-contact-sheet.html`), buildContactSheetHtml(requestId, generated));
  return {
    status: generated.every((item) => item.artifacts_exist) ? 'generated' : (generated.some((item) => item.artifacts_exist) ? 'design_ready' : 'prompt_pack_ready'),
    provider: providerConfig.name,
    options: generated,
    contact_sheet: `.ai/designs/generated/${requestId}-contact-sheet.html`,
    note: errors.length ? `GPT Image provider completed with ${errors.length} error(s).` : 'GPT Image provider generated production mockups.',
    errors,
    cost_preview: estimated
  };
}

function generateImageFileSync(providerConfig, apiKey, prompt, size, outputFile) {
  // Synchronous wrapper around fetch via child Node process keeps the public engine API sync.
  ensureDir(path.dirname(outputFile));
  const script = `
const fs = require('node:fs');
const payload = JSON.parse(process.env.ACF_IMAGE_PAYLOAD);
(async()=>{
  const res = await fetch(payload.endpoint,{method:'POST',headers:{Authorization:'Bearer '+payload.apiKey,'Content-Type':'application/json'},body:JSON.stringify(payload.body)});
  const txt = await res.text();
  if(!res.ok){ console.error(txt.slice(0,2000)); process.exit(2); }
  const json = JSON.parse(txt);
  const b64 = json.data && json.data[0] && json.data[0].b64_json;
  if(!b64){ console.error('No b64_json in image response'); process.exit(3); }
  fs.writeFileSync(payload.outputFile, Buffer.from(b64,'base64'));
})();`;
  const payload = {
    endpoint: providerConfig.endpoint,
    apiKey,
    outputFile,
    body: {
      model: providerConfig.model,
      prompt,
      size,
      quality: providerConfig.quality,
      output_format: providerConfig.output_format,
      n: 1
    }
  };
  const result = runCommand(process.execPath, ['-e', script], { timeout: providerConfig.timeout_ms || 600000, env: { ...process.env, ACF_IMAGE_PAYLOAD: JSON.stringify(payload) } });
  if (!result.success) throw new Error(result.stderr_preview || result.error || `image generation exited ${result.status}`);
}

export function designCostPreview(config = {}, imageCount = 6) {
  const providerConfig = config.design ? resolveDesignProvider(config) : config;
  const count = Number(imageCount || 6);
  if (providerConfig.kind === 'gpt-image-codex') {
    return {
      provider: providerConfig.name || 'gpt-image',
      kind: providerConfig.kind,
      model: 'codex-design-provider',
      quality: providerConfig.quality_mode || 'production-mock',
      image_count: count,
      estimated_cost_per_image_usd: 0,
      estimated_cost_usd: 0,
      note: 'Codex-backed design provider uses your Codex/ChatGPT CLI session. No OpenAI Images API key is required by the harness; usage is subject to your Codex plan limits.'
    };
  }
  return {
    provider: providerConfig.name || 'gpt-image',
    kind: providerConfig.kind || 'unknown',
    model: providerConfig.model || 'gpt-image-2',
    quality: providerConfig.quality || 'medium',
    image_count: count,
    estimated_cost_per_image_usd: Number(providerConfig.estimated_cost_per_image_usd || 0.05),
    estimated_cost_usd: count * Number(providerConfig.estimated_cost_per_image_usd || 0.05),
    note: 'Estimate only. Final API billing depends on model, quality, size and provider pricing.'
  };
}


function buildCodexProviderArgs(baseArgs, root, instruction) {
  const args = [...(Array.isArray(baseArgs) ? baseArgs : parseArgs(baseArgs))];
  const cIndex = args.lastIndexOf('-C');
  if (cIndex >= 0) {
    if (args.length === cIndex + 1) args.push(root);
    else args[cIndex + 1] = root; // always point Codex at the project root; never leave a stray positional arg
  } else {
    args.push('-C', root);
  }
  args.push(instruction);
  return args;
}

function buildCodexDesignProviderPrompt({ requestId, providerConfig, context, jobFile, optionKey = 'a', strategy = 'html-first', htmlTargets = null }) {
  const desktopPng = `.ai/designs/generated/${requestId}-option-${optionKey}-desktop.png`;
  const mobilePng = `.ai/designs/generated/${requestId}-option-${optionKey}-mobile.png`;
  const desktop = strategy === 'html-first' ? (htmlTargets?.desktop || desktopPng.replace(/\.png$/, '.html')) : desktopPng;
  const mobile = strategy === 'html-first' ? (htmlTargets?.mobile || mobilePng.replace(/\.png$/, '.html')) : mobilePng;
  const research = context.designResearch ? `\n## Current design research\n\n${clipText(context.designResearch, 4000)}\n` : '';
  const htmlRules = strategy === 'html-first' ? [
    '',
    '## HTML mockup contract (html-first strategy)',
    '',
    '- Each file must be a SINGLE self-contained HTML document: inline <style>, no external fonts/CDNs/images, no network requests, no JavaScript required for the visual.',
    '- Desktop file: design for a 1440px-wide viewport. Mobile file: design for a 430px-wide viewport.',
    '- Imagery: use inline SVG illustrations, CSS gradients with texture/depth, or data-URI images you generate. Hero and gallery areas must look like a finished site, never empty gray boxes.',
    '- The harness will screenshot these files headlessly to produce the final PNGs; treat them as the final visual deliverable.',
    ''
  ] : [''];
  return [
    `# Codex Design Provider — ${requestId} / option-${optionKey}`,
    '',
    'You are a senior creative director and visual design provider inside AI Code Factory.',
    '',
    '## Task',
    '',
    `Generate exactly ONE production-level design option: option-${optionKey}.`,
    `Create these two files only:`,
    `- ${desktop}`,
    `- ${mobile}`,
    ...htmlRules,
    '## Hard rules',
    '',
    '- DESIGN STAGE ONLY: do not modify src/, app/, pages/, components/, tests/, package.json or production files.',
    '- Only write under .ai/designs/generated and optional provider notes under .ai/designs/manifests.',
    strategy === 'html-first'
      ? '- Create polished, high-fidelity HTML mockups, not wireframes, skeletons or unstyled markup.'
      : '- Create real high-fidelity production mockup images, not wireframes, rectangles, skeletons or screenshots of code.',
    '- If you cannot produce the requested artifacts, report that clearly and leave them absent. Do not fake success.',
    '',
    '## Senior quality bar',
    '',
    `Design quality: ${providerConfig.quality_mode || 'production-mock'}`,
    `Creativity: ${providerConfig.creativity || 'creative-director'}`,
    '- Client-presentable, elegant, polished, modern, and surprising without being noisy.',
    '- Use design patterns inspired by current premium sites: editorial hero, cinematic imagery, high hierarchy, precise spacing, texture/material details, interactive before/after affordance.',
    '- Use synthetic branding/logo/wordmark and synthetic imagery when missing.',
    '- No fake real claims: no real phone/email/address/metrics/certifications/client names/legal claims.',
    '- Contact data must remain explicit placeholders.',
    '- Include visual cues for real interactions: draggable before/after slider, hoverable cards, sticky/mobile CTA where useful.',
    research,
    '## Source prompt pack excerpt',
    '',
    clipText(context.prompt, 8000),
    '',
    '## Finish condition',
    '',
    `Finish only after ${desktop} and ${mobile} exist with real content. If unable, explain why in stdout.`
  ].join('\n');
}


function buildGptImagePrompt({ requestId, providerConfig, intake, brief, context, answers, optionKey, optionLabel, mode }) {
  const senior = providerConfig.quality_mode || 'production-mock';
  const creativity = providerConfig.creativity || 'creative-director';
  return [
    `Create a ${mode} final production-grade website mockup for ${requestId}, ${optionLabel}.`,
    `Quality mode: ${senior}. Creativity mode: ${creativity}.`,
    'Act as a senior creative director, senior UX/UI designer and conversion-focused product designer.',
    'The output must look like a polished final production mockup, not a wireframe, not a skeleton, not a low-fidelity concept.',
    'Use modern premium composition, tasteful typography, strong hierarchy, emotionally engaging visuals, realistic synthetic imagery when assets are missing, and clear conversion paths.',
    'If no logo exists, create a refined synthetic wordmark/monogram treatment. If no photos exist, generate synthetic interior renovation/property valorization visuals. If copy is missing, create premium demo copy while avoiding fake hard claims.',
    'Do not invent real phone numbers, real emails, real addresses, real metrics, certifications, client names, or legal claims as factual. Use explicit placeholders for contact data or label content as demo/synthetic visually when appropriate.',
    'Include: hero, services, before/after showcase, contact CTA, professional footer, mobile-responsive thinking.',
    'For before/after, show compelling renovation transformation imagery or a visual comparison module. Make it the engagement moment.',
    'Preferred visual feel: premium real estate, architecture/interior design, warm neutral palette, charcoal typography, refined bronze/tan accents, disciplined spacing, contemporary editorial rhythm.',
    'Design must be implementation-friendly for Next.js sections/components.',
    '',
    'DESIGN BRIEF:',
    clipText(brief, 5000),
    '',
    'USER ANSWERS:',
    answers || 'No explicit answers recorded.',
    '',
    'CONTEXT EXCERPT:',
    clipText(context, 2500),
    '',
    'Return only the image. No annotations outside the mockup.'
  ].join('\n');
}

function buildSyntheticAssetManifest(requestId, providerConfig, intake) {
  return {
    request_id: requestId,
    generated_at: nowIso(),
    mode: providerConfig.creativity || 'creative-director',
    logo: providerConfig.brand_bootstrap ? 'synthetic_allowed' : 'not_generated',
    images: providerConfig.synthetic_assets ? 'synthetic_allowed' : 'placeholders_only',
    copy: providerConfig.synthetic_assets ? 'demo_copy_allowed' : 'strict_placeholders',
    contact_data: 'explicit_placeholders_only',
    metrics: 'not_generated_as_real_claims',
    legal_claims: 'not_generated',
    source_intent: intake?.interpreted_intent || null
  };
}

function buildCreativeDirection(requestId, providerConfig, context) {
  return [
    `# Creative Direction — ${requestId}`,
    '',
    `Quality: ${providerConfig.quality_mode}`,
    `Creativity: ${providerConfig.creativity}`,
    '',
    '## Senior direction',
    '- Build a final production mockup, not a wireframe.',
    '- Use premium real-estate/interior-design language when relevant.',
    '- Prioritize emotional clarity, trust, visual transformation and conversion.',
    '- Create synthetic branding/assets when missing, but keep real contact data as placeholders.',
    '',
    '## Engagement hooks',
    '- Strong hero visual.',
    '- Before/after transformation as a wow moment.',
    '- Clear CTA above fold and repeated near close.',
    '- Mobile CTA pattern if applicable.'
  ].join('\n');
}

function buildInteractionPlan(requestId, context) {
  return [
    `# Interaction Plan — ${requestId}`,
    '',
    '- Hero CTA hover/focus state.',
    '- Before/after slider or comparison interaction.',
    '- Service cards with subtle hover elevation.',
    '- Mobile sticky CTA if conversion-focused.',
    '- Form/contact states if form is implemented.',
    '- Keyboard-visible focus states for interactive elements.'
  ].join('\n');
}

function buildMotionPlan(requestId) {
  return [
    `# Motion Plan — ${requestId}`,
    '',
    '- Use subtle reveal animation for sections, 180–280ms ease-out.',
    '- Avoid excessive parallax or heavy animation dependencies.',
    '- Respect prefers-reduced-motion.',
    '- Motion must clarify hierarchy or interaction, never distract.'
  ].join('\n');
}

function runExternalCommandProvider(root, requestId, providerConfig, context) {
  const command = process.env[providerConfig.command_env || ''] || providerConfig.command;
  const argsValue = process.env[providerConfig.args_env || ''] || providerConfig.args || '';
  if (!command) {
    return { status: 'prompt_pack_ready', provider: providerConfig.name, options: [], note: `Provider ${providerConfig.name} is configured as external-command but no command was supplied.` };
  }
  const jobFile = aiPath(root, 'designs', 'prompts', `${requestId}-design-job.json`);
  const outputTargets = Object.fromEntries(Object.entries(context.outputPlan).map(([k, v]) => [k, { desktop: v.desktop.rel, mobile: v.mobile.rel }]));
  const job = {
    request_id: requestId,
    provider: providerConfig.name,
    prompt: context.prompt,
    prompt_file: aiPath(root, 'designs', 'prompts', `${requestId}-design-prompt-pack.md`),
    output_targets: outputTargets,
    note: 'The external tool should generate the target files and may optionally return JSON to stdout.'
  };
  writeJson(jobFile, job);
  const args = parseArgs(argsValue);
  const useArgMode = providerConfig.prompt_mode === 'arg';
  const result = runCommand(command, useArgMode ? [...args, jobFile] : args, { cwd: root, timeout: Number(providerConfig.timeout_ms || 300000), input: useArgMode ? undefined : JSON.stringify(job, null, 2) });
  writeJson(aiPath(root, 'designs', 'manifests', `${requestId}-provider-run.json`), result);
  const options = collectGeneratedOptions(outputTargets, providerConfig.name, requestId, root);
  const status = options.some((item) => item.artifacts_exist) ? (options.every((item) => item.artifacts_exist) ? 'generated' : 'design_ready') : 'prompt_pack_ready';
  return {
    status,
    provider: providerConfig.name,
    options,
    note: result.success ? 'External provider executed.' : `External provider did not complete successfully: ${result.error || result.stderr_preview || 'unknown error'}`,
    command_result: result
  };
}

function collectGeneratedOptions(outputTargets, providerName, requestId, root, designConfig = {}) {
  return Object.entries(outputTargets).map(([key, target]) => {
    const desktop = resolveOptionArtifact(root, target.desktop, designConfig);
    const mobile = resolveOptionArtifact(root, target.mobile, designConfig);
    return {
      id: `${requestId}-option-${key}`,
      label: `Option ${String(key).toUpperCase()}`,
      desktop_image: desktop.valid ? desktop.rel : target.desktop,
      mobile_image: mobile.valid ? mobile.rel : target.mobile,
      artifact_kind: desktop.valid ? desktop.kind : null,
      artifacts_exist: desktop.valid && mobile.valid,
      source: providerName,
      created_at: nowIso()
    };
  });
}

function buildManifestFromGeneration(root, requestId, providerName, outputPlan, generation, designConfig = {}) {
  const generatedOptions = (generation.options || []).length ? generation.options : Object.entries(outputPlan).map(([key, target]) => {
    const desktop = resolveOptionArtifact(root, target.desktop.rel, designConfig);
    const mobile = resolveOptionArtifact(root, target.mobile.rel, designConfig);
    return {
      id: `${requestId}-option-${key}`,
      label: `Option ${String(key).toUpperCase()}`,
      desktop_image: desktop.valid ? desktop.rel : target.desktop.rel,
      mobile_image: mobile.valid ? mobile.rel : target.mobile.rel,
      artifact_kind: desktop.valid ? desktop.kind : null,
      artifacts_exist: desktop.valid && mobile.valid,
      source: providerName,
      created_at: nowIso()
    };
  });
  const someExist = generatedOptions.some((o) => o.artifacts_exist);
  const allExist = generatedOptions.length > 0 && generatedOptions.every((o) => o.artifacts_exist);
  return {
    request_id: requestId,
    provider: providerName,
    fallback_from: generation.fallback_from || null,
    status: generation.status === 'generated' ? 'generated' : (allExist ? 'generated' : (someExist ? 'design_ready' : 'prompt_pack_ready')),
    recommended_option: generatedOptions.find((o) => o.artifacts_exist)?.id || generatedOptions[0]?.id || `${requestId}-option-a`,
    options: generatedOptions,
    contact_sheet: generation.contact_sheet || `.ai/designs/generated/${requestId}-contact-sheet.html`,
    updated_at: nowIso(),
    note: generation.note || 'If artifacts_exist is false, import generated images or configure a provider. Do not pretend images exist.'
  };
}

function buildOutputPlan(root, requestId, providerConfig = {}) {
  const out = {};
  const ext = (providerConfig.kind === 'gpt-image-api' || providerConfig.kind === 'gpt-image-codex') ? (providerConfig.output_format || 'png') : 'svg';
  for (const key of ['a', 'b', 'c']) {
    out[key] = {
      desktop: buildTarget(root, `designs/generated/${requestId}-option-${key}-desktop.${ext}`),
      mobile: buildTarget(root, `designs/generated/${requestId}-option-${key}-mobile.${ext}`)
    };
  }
  return out;
}

function buildTarget(root, relativeInsideAi) {
  const relPath = `.ai/${relativeInsideAi}`;
  return { rel: relPath, abs: path.join(root, relPath) };
}

function resolveDesignProvider(config = {}) {
  const design = config.design || {};
  const providerName = process.env.ACF_DESIGN_PROVIDER || design.default_provider || 'manual-import';
  const providers = design.providers || {};
  const provider = providers[providerName] || {};
  const gpt = design.gpt_image || {};
  return {
    name: providerName,
    kind: provider.kind || providerName,
    command_env: provider.command_env,
    args_env: provider.args_env,
    prompt_mode: provider.prompt_mode || 'stdin',
    timeout_ms: provider.timeout_ms || 300000,
    command: provider.command,
    args: provider.args,
    quality_mode: process.env.ACF_DESIGN_QUALITY || design.quality || 'production-mock',
    creativity: process.env.ACF_DESIGN_CREATIVITY || design.creativity || 'creative-director',
    synthetic_assets: process.env.ACF_ALLOW_SYNTHETIC_ASSETS ? process.env.ACF_ALLOW_SYNTHETIC_ASSETS !== 'false' : design.synthetic_assets !== false,
    brand_bootstrap: process.env.ACF_BRAND_BOOTSTRAP ? process.env.ACF_BRAND_BOOTSTRAP !== 'false' : design.brand_bootstrap !== false,
    api_key_env: process.env.ACF_DESIGN_API_KEY_ENV || gpt.api_key_env || 'OPENAI_API_KEY',
    model: process.env.ACF_DESIGN_IMAGE_MODEL || gpt.model || 'gpt-image-2',
    endpoint: process.env.ACF_DESIGN_IMAGE_ENDPOINT || gpt.endpoint || 'https://api.openai.com/v1/images/generations',
    quality: process.env.ACF_DESIGN_IMAGE_QUALITY || gpt.quality || 'medium',
    output_format: process.env.ACF_DESIGN_IMAGE_FORMAT || gpt.output_format || 'png',
    desktop_size: process.env.ACF_DESIGN_DESKTOP_SIZE || gpt.desktop_size || '1536x1024',
    mobile_size: process.env.ACF_DESIGN_MOBILE_SIZE || gpt.mobile_size || '1024x1536',
    estimated_cost_per_image_usd: Number(process.env.ACF_DESIGN_ESTIMATED_COST_PER_IMAGE_USD || gpt.estimated_cost_per_image_usd || 0.05),
    require_confirm: process.env.ACF_DESIGN_REQUIRE_CONFIRM ? process.env.ACF_DESIGN_REQUIRE_CONFIRM !== 'false' : gpt.require_confirm !== false,
    require_real_image: provider.require_real_image !== false,
    codex: {
      command: process.env.ACF_DESIGN_CODEX_COMMAND || provider.codex?.command,
      args: process.env.ACF_DESIGN_CODEX_ARGS || provider.codex?.args,
      timeout_ms: Number(process.env.ACF_DESIGN_CODEX_TIMEOUT_MS || provider.codex?.timeout_ms || 900000)
    }
  };
}

function buildDesignPromptPack({ requestId, providerConfig, intake, brief, context, answers, outputPlan, designResearch = '' }) {
  const outputs = [];
  for (const key of ['a', 'b', 'c']) {
    outputs.push(`- ${outputPlan[key].desktop.rel}`);
    outputs.push(`- ${outputPlan[key].mobile.rel}`);
  }
  return [
    `# Design Prompt Pack — ${requestId}`,
    '',
    `Provider: ${providerConfig.name}`,
    '',
    '## Goal',
    '',
    'Generate 3 distinct high-quality design options (option-a, option-b, option-c) for the request. Each option must include a desktop and mobile composition. Respect the design brief, context pack, and user answers. Never invent business data.',
    '',
    '## Source of Truth',
    '',
    '1. Design brief',
    '2. User answers / clarifications',
    '3. Context pack',
    '',
    '## Design Brief',
    '',
    brief,
    '',
    '## User Answers / Clarifications',
    '',
    answers || 'No explicit answers recorded.',
    '',
    '## Context Pack Excerpt',
    '',
    clipText(context, 6000),
    '',
    '## Design Research / Inspiration',
    '',
    designResearch ? clipText(designResearch, 5000) : 'No design research file found yet. Run npm run ai -- design-research to gather current references and patterns.',
    '',
    '## Visual Requirements',
    '',
    '- Premium, sober, professional aesthetic.',
    '- Strong hero with clear CTA.',
    '- Professional service section.',
    '- Before/after or proof section when requested.',
    '- Honest contact section using placeholders if real data is missing.',
    '- Mobile-first discipline; provide mobile variant for every concept.',
    '- No giant typography, no flashy gimmicks, no fake metrics.',
    '',
    '## Output Contract',
    '',
    ...outputs,
    '- .ai/designs/generated/' + `${requestId}-contact-sheet.html`,
    '',
    '## Provider Notes',
    '',
    providerConfig.kind === 'wireframe-mock'
      ? 'Use structured SVG wireframes with clear sections and labels.'
      : providerConfig.kind === 'gpt-image-codex'
        ? 'Codex must act as a design-only provider: create production-quality PNG mockups and save them exactly at the requested artifact paths. Do not modify app/source files.'
        : 'If the external provider cannot generate all artifacts, it must generate as many as possible and leave the rest absent. The harness will verify file existence.',
    '',
    '## Metadata',
    '',
    `Work type: ${intake.work_type || 'unknown'}`,
    `Risk: ${intake.risk || 'unknown'}`,
    `Workflow: ${intake.recommended_workflow || 'unknown'}`
  ].join('\n');
}

function buildWireframeSvg({ width, height, variant, intake, requestId, mode }) {
  const brand = extractBrand(intake) || 'Brand';
  const heroTitle = escapeXml(brand);
  const heroSubtitle = escapeXml(extractSubtitle(intake));
  const accent = variant.accent;
  const isMobile = mode === 'mobile';
  const cardW = isMobile ? width - 64 : 280;
  const gap = isMobile ? 0 : 26;
  const serviceY = isMobile ? 440 : 520;
  const galleryY = isMobile ? 860 : 910;
  const footerY = height - 140;
  const cards = [];
  for (let i = 0; i < 4; i++) {
    const x = isMobile ? 32 : 80 + i * (cardW + gap);
    const y = isMobile ? serviceY + i * 160 : serviceY;
    cards.push(`<rect x="${x}" y="${y}" width="${cardW}" height="120" rx="16" fill="#ffffff" stroke="#d8cec4"/>`);
    cards.push(`<text x="${x + 20}" y="${y + 42}" font-family="Arial" font-size="22" fill="#2e2e2e">Servicio ${i + 1}</text>`);
    cards.push(`<text x="${x + 20}" y="${y + 74}" font-family="Arial" font-size="16" fill="#6b6762">Placeholder descriptivo</text>`);
  }
  const gallery = [];
  for (let i = 0; i < 3; i++) {
    const baseY = isMobile ? galleryY + i * 220 : galleryY + i * 200;
    if (isMobile) {
      gallery.push(`<rect x="32" y="${baseY}" width="${width - 64}" height="84" rx="14" fill="#ffffff" stroke="#d8cec4"/>`);
      gallery.push(`<text x="52" y="${baseY + 50}" font-family="Arial" font-size="18" fill="#2e2e2e">Antes / Después ${i + 1}</text>`);
    } else {
      gallery.push(`<rect x="80" y="${baseY}" width="${(width - 220) / 2}" height="150" rx="16" fill="#ffffff" stroke="#d8cec4"/>`);
      gallery.push(`<rect x="${110 + (width - 220) / 2}" y="${baseY}" width="${(width - 220) / 2}" height="150" rx="16" fill="#ffffff" stroke="#d8cec4"/>`);
      gallery.push(`<text x="110" y="${baseY + 82}" font-family="Arial" font-size="20" fill="#2e2e2e">Antes</text>`);
      gallery.push(`<text x="${140 + (width - 220) / 2}" y="${baseY + 82}" font-family="Arial" font-size="20" fill="#2e2e2e">Después</text>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f5efe8"/>
  <rect x="0" y="0" width="100%" height="16" fill="${accent}"/>
  <text x="${isMobile ? 32 : 80}" y="${isMobile ? 70 : 88}" font-family="Arial" font-size="${isMobile ? 30 : 40}" font-weight="700" fill="#2e2e2e">${heroTitle}</text>
  <text x="${isMobile ? 32 : 80}" y="${isMobile ? 110 : 128}" font-family="Arial" font-size="${isMobile ? 16 : 20}" fill="#68625d">${escapeXml(variant.theme)}</text>
  <text x="${isMobile ? 32 : 80}" y="${isMobile ? 180 : 210}" font-family="Arial" font-size="${isMobile ? 30 : 54}" font-weight="700" fill="#232323">${heroSubtitle}</text>
  <text x="${isMobile ? 32 : 80}" y="${isMobile ? 230 : 258}" font-family="Arial" font-size="${isMobile ? 16 : 20}" fill="#68625d">CTA visible • placeholders honestos • layout ${mode}</text>
  <rect x="${isMobile ? 32 : 80}" y="${isMobile ? 270 : 300}" width="${isMobile ? 210 : 240}" height="56" rx="14" fill="${accent}"/>
  <text x="${isMobile ? 58 : 112}" y="${isMobile ? 305 : 336}" font-family="Arial" font-size="${isMobile ? 20 : 22}" fill="#ffffff">Contacto pendiente</text>
  <text x="${isMobile ? 32 : 80}" y="${isMobile ? 390 : 470}" font-family="Arial" font-size="${isMobile ? 28 : 36}" font-weight="700" fill="#2e2e2e">Servicios</text>
  ${cards.join('\n  ')}
  <text x="${isMobile ? 32 : 80}" y="${isMobile ? 820 : 870}" font-family="Arial" font-size="${isMobile ? 28 : 36}" font-weight="700" fill="#2e2e2e">Antes / Después</text>
  ${gallery.join('\n  ')}
  <text x="${isMobile ? 32 : 80}" y="${footerY}" font-family="Arial" font-size="${isMobile ? 16 : 18}" fill="#68625d">Email pendiente • Teléfono pendiente • Ubicación pendiente</text>
  <text x="${isMobile ? 32 : 80}" y="${footerY + 30}" font-family="Arial" font-size="${isMobile ? 13 : 15}" fill="#8a837d">${escapeXml(requestId)} · ${escapeXml(variant.label)} · Built-in wireframe mock</text>
</svg>`;
}

function buildContactSheetHtml(requestId, options) {
  const items = options.map((option) => `<div style="margin-bottom:24px"><h3>${option.label}</h3><p>${option.desktop_image}<br/>${option.mobile_image}</p></div>`).join('');
  return `<!doctype html><html><body style="font-family:Arial;padding:24px"><h1>Contact sheet — ${requestId}</h1>${items}</body></html>`;
}

function optionArtifactsExist(root, option, designConfig = {}) {
  if (!option.desktop_image) return false;
  const desktop = resolveOptionArtifact(root, option.desktop_image, designConfig);
  if (!desktop.valid) return false;
  if (!option.mobile_image) return true;
  return resolveOptionArtifact(root, option.mobile_image, designConfig).valid;
}

function optionIds(manifest) { return (manifest.options || []).map((item) => item.id); }

function suggestOptions(candidates, options) {
  const ids = optionIds({ options });
  const joined = candidates.join(' ');
  if (/option-b/i.test(joined)) return ids.filter((id) => /option-b/i.test(id));
  if (/option-a/i.test(joined)) return ids.filter((id) => /option-a/i.test(id));
  if (/option-c/i.test(joined)) return ids.filter((id) => /option-c/i.test(id));
  return ids;
}

function rel(root, file) { return path.relative(root, file).split(path.sep).join('/'); }

function clipText(text, max) {
  const value = String(text || '');
  return value.length <= max ? value : `${value.slice(0, max)}\n\n...[truncated]`;
}

function extractContextNotes(context) {
  if (!context) return '- No context pack summary available yet.';
  const section = context.split(/\n## /).find((chunk) => /User Answers|Allowed assumptions|Missing info|Tool routing/i.test(chunk));
  return section ? section.split('\n').slice(0, 18).join('\n') : clipText(context, 1000);
}

function deriveDirection(intake, answers) {
  const answerText = String(answers || '');
  const warm = /warm|neutr|sober|premium|elegant|elegante/i.test(answerText + ' ' + (intake.raw_user_ask || ''));
  const palette = warm ? 'Warm neutral palette, calm premium feel, sober typography and honest placeholders.' : 'Contemporary, clean, professional visual system with restrained accent color.';
  return `${palette} Strong hierarchy, high clarity, conversion-oriented, and visually disciplined.`;
}

function extractBrand(intake) {
  const ask = String(intake.raw_user_ask || '');
  const match = ask.match(/para\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+){0,3})/);
  if (match) return match[1].trim();
  return null;
}

function extractSubtitle(intake) {
  const ask = String(intake.raw_user_ask || '').toLowerCase();
  if (/reforma|inmueble|propiedad/.test(ask)) return 'Reformas y puesta en valor de inmuebles';
  if (/landing/.test(ask)) return 'Landing profesional con hero, servicios y CTA';
  return 'Solución visual profesional';
}

function escapeXml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseArgs(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

export function designDoctor(root, config = {}) {
  const designConfig = config.design || {};
  const providerConfig = resolveDesignProvider(config);
  const codexCommand = process.env.ACF_DESIGN_CODEX_COMMAND || providerConfig.codex?.command || config.execution?.codex?.command || 'codex';
  const codexAvailable = commandExists(codexCommand);
  const renderer = detectHtmlRenderer(designConfig);
  const apiKeyEnv = providerConfig.api_key_env || 'OPENAI_API_KEY';
  const apiKeyPresent = Boolean(process.env[apiKeyEnv]);
  const strategy = process.env.ACF_DESIGN_CODEX_STRATEGY || designConfig.codex_artifact_strategy || 'html-first';
  const fallbackChain = designConfig.fallback_chain || ['gpt-image-codex', 'gpt-image-api', 'wireframe-mock'];

  const checks = [
    { id: 'active_provider', status: 'info', detail: `${providerConfig.name} (${providerConfig.kind})` },
    { id: 'codex_cli', status: codexAvailable ? 'ok' : (providerConfig.kind === 'gpt-image-codex' ? 'fail' : 'warning'), detail: codexAvailable ? `Found: ${codexCommand}` : `Not found: ${codexCommand}. Install Codex CLI or switch provider.` },
    { id: 'codex_strategy', status: strategy === 'html-first' ? 'ok' : 'warning', detail: strategy === 'html-first' ? 'html-first: Codex builds HTML mockups; the harness rasterizes them.' : `Strategy "${strategy}": Codex cannot create raster images directly; expect failures unless an image tool exists.` },
    { id: 'html_renderer', status: renderer.available ? 'ok' : 'warning', detail: renderer.available ? `Found: ${renderer.command} (HTML mockups will be rasterized to PNG).` : 'No Chromium/Chrome/Edge found. HTML mockups are still accepted as valid artifacts; PNGs will be skipped.' },
    { id: 'images_api_key', status: apiKeyPresent ? 'ok' : 'info', detail: apiKeyPresent ? `${apiKeyEnv} present (gpt-image-api available with --confirm).` : `${apiKeyEnv} absent (gpt-image-api fallback disabled).` },
    { id: 'fallback_chain', status: designConfig.auto_fallback !== false ? 'ok' : 'warning', detail: designConfig.auto_fallback !== false ? `Enabled: ${fallbackChain.join(' → ')}` : 'Auto-fallback disabled; a failed provider will dead-end until you intervene.' }
  ];

  let predicted;
  if (providerConfig.kind === 'gpt-image-codex') {
    if (codexAvailable && renderer.available) predicted = 'Codex builds HTML mockups → harness rasterizes to PNG → manifest design_ready/generated.';
    else if (codexAvailable) predicted = 'Codex builds HTML mockups → accepted as HTML artifacts (no local browser for PNG).';
    else predicted = `Codex missing → automatic fallback to: ${fallbackChain.filter((n) => n !== providerConfig.name).join(' → ') || 'none'}.`;
  } else if (providerConfig.kind === 'gpt-image-api') {
    predicted = apiKeyPresent ? 'Images API generation (requires --confirm to spend billing).' : `Missing ${apiKeyEnv}; will fall back per chain.`;
  } else {
    predicted = `${providerConfig.kind} provider runs directly.`;
  }

  const failures = checks.filter((c) => c.status === 'fail');
  return {
    status: failures.length ? 'attention_required' : 'ok',
    provider: providerConfig.name,
    kind: providerConfig.kind,
    strategy,
    codex: { command: codexCommand, available: codexAvailable },
    renderer,
    api_key_env: apiKeyEnv,
    api_key_present: apiKeyPresent,
    fallback_chain: fallbackChain,
    auto_fallback: designConfig.auto_fallback !== false,
    predicted_behavior: predicted,
    checks,
    generated_at: nowIso()
  };
}

// ---------------------------------------------------------------------------
// v4.5 Reliable artifact layer
// Codex CLI is a code agent: it can build HTML mockups but cannot create
// raster images. The harness therefore (1) accepts HTML/SVG/PNG artifacts as
// first-class design options, (2) validates them so empty files never pass as
// "generated", and (3) rasterizes HTML to PNG with a local headless browser
// when one is available.
// ---------------------------------------------------------------------------

const ARTIFACT_EXT_CANDIDATES = ['png', 'html', 'svg', 'jpg', 'jpeg', 'webp'];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export function validateDesignArtifact(absPath, designConfig = {}) {
  if (!absPath || !exists(absPath)) return { valid: false, reason: 'missing' };
  let stat;
  try { stat = fs.statSync(absPath); } catch { return { valid: false, reason: 'unreadable' }; }
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const minPng = Number(designConfig.min_png_bytes ?? 4096);
  const minHtml = Number(designConfig.min_html_bytes ?? 300);
  const minSvg = Number(designConfig.min_svg_bytes ?? 256);
  if (ext === 'png') {
    if (stat.size < minPng) return { valid: false, reason: `png too small (${stat.size}b < ${minPng}b)`, kind: 'png' };
    let head;
    try { head = Buffer.alloc(4); const fd = fs.openSync(absPath, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd); } catch { return { valid: false, reason: 'unreadable', kind: 'png' }; }
    if (!head.equals(PNG_MAGIC)) return { valid: false, reason: 'invalid png signature', kind: 'png' };
    return { valid: true, kind: 'png' };
  }
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
    if (stat.size < minPng) return { valid: false, reason: `image too small (${stat.size}b)`, kind: ext };
    return { valid: true, kind: ext };
  }
  if (ext === 'html' || ext === 'htm') {
    if (stat.size < minHtml) return { valid: false, reason: `html too small (${stat.size}b < ${minHtml}b)`, kind: 'html' };
    const head = readText(absPath, '').slice(0, 4000);
    if (!/<!doctype|<html|<body/i.test(head)) return { valid: false, reason: 'not an html document', kind: 'html' };
    return { valid: true, kind: 'html' };
  }
  if (ext === 'svg') {
    if (stat.size < minSvg) return { valid: false, reason: `svg too small (${stat.size}b)`, kind: 'svg' };
    if (!/<svg[\s>]/i.test(readText(absPath, '').slice(0, 2000))) return { valid: false, reason: 'not an svg document', kind: 'svg' };
    return { valid: true, kind: 'svg' };
  }
  return { valid: stat.size > 0, kind: ext || 'unknown' };
}

export function resolveOptionArtifact(root, plannedRel, designConfig = {}) {
  const planned = String(plannedRel || '');
  if (!planned) return { valid: false, reason: 'no planned path' };
  const base = planned.replace(/\.[a-z0-9]+$/i, '');
  const plannedExt = (planned.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const order = [plannedExt, ...ARTIFACT_EXT_CANDIDATES.filter((ext) => ext !== plannedExt)].filter(Boolean);
  for (const ext of order) {
    const relPath = `${base}.${ext}`;
    const abs = path.resolve(root, relPath);
    const check = validateDesignArtifact(abs, designConfig);
    if (check.valid) return { valid: true, rel: relPath, abs, kind: check.kind };
  }
  return { valid: false, rel: planned, reason: 'no valid artifact found at planned path or alternates' };
}

const RENDERER_CANDIDATES = process.platform === 'win32'
  ? ['chrome', 'msedge', 'chromium', 'brave',
     'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
     'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome', 'brave-browser', 'msedge',
     '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
     '/Applications/Chromium.app/Contents/MacOS/Chromium',
     '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];

export function detectHtmlRenderer(designConfig = {}) {
  const explicit = process.env.ACF_DESIGN_HTML_RENDERER || designConfig.html_renderer;
  const candidates = explicit ? [explicit, ...RENDERER_CANDIDATES] : RENDERER_CANDIDATES;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (path.isAbsolute(candidate)) {
      if (exists(candidate)) return { available: true, command: candidate, source: candidate === explicit ? 'explicit' : 'auto' };
      continue;
    }
    if (commandExists(candidate)) return { available: true, command: candidate, source: candidate === explicit ? 'explicit' : 'auto' };
  }
  return { available: false, command: null, source: null, note: 'No Chromium-based browser found for headless HTML→PNG rasterization. HTML mockups remain valid artifacts.' };
}

export function rasterizeHtmlToPng(rendererCommand, htmlAbs, pngAbs, { width = 1440, height = 2200, timeoutMs = 120000 } = {}) {
  ensureDir(path.dirname(pngAbs));
  const fileUrl = pathToFileURL(htmlAbs).href;
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${pngAbs}`,
    '--virtual-time-budget=8000',
    fileUrl
  ];
  let result = runCommand(rendererCommand, args, { timeout: timeoutMs });
  if (!result.success || !exists(pngAbs)) {
    // Older Chromium builds reject --headless=new; retry with classic headless.
    const legacyArgs = ['--headless', ...args.slice(1)];
    result = runCommand(rendererCommand, legacyArgs, { timeout: timeoutMs });
  }
  const produced = exists(pngAbs);
  return { success: Boolean(result.success && produced), produced, status: result.status, error: result.error, stderr_preview: result.stderr_preview };
}
