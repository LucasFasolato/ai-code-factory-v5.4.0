import { readFileSync } from 'node:fs';
// Single source of truth: the package.json version. Hardcoded constants drift
// (v5.0.1 shipped with a doctor still announcing 4.7.1).
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const DEFAULT_CONFIG = {
  version: VERSION,
  project: {
    name: 'AI Code Factory Project',
    mode: 'balanced',
    timezone: 'America/Argentina/Buenos_Aires'
  },
  interface: {
    simple_commands_first: true,
    dashboard_port: 3333
  },
  token_budget: {
    mode: 'balanced',
    max_reference_urls_per_task: 5,
    include_logs: false,
    include_history_limit: 3,
    summarize_long_files: true,
    prefer_context_pack: true,
    include_design_images_only_if_relevant: true,
    max_context_pack_chars: 24000
  },
  brain_context: {
    mode: 'token-efficient',
    use_context_router: true,
    use_context_cache: true,
    max_planner_chars: 6000,
    max_specialist_chars: 12000,
    max_summary_chars: 1600,
    never_send_full_standards: true,
    never_send_full_history: true
  },

  ai_intake: {
    enabled: true,
    mode: 'hybrid',
    provider: 'claude-code',
    fallback_chain: ['claude-code', 'openai', 'heuristic'],
    model: 'gpt-4.1',
    api_key_env: 'OPENAI_API_KEY',
    base_url: 'https://api.openai.com/v1/responses',
    timeout_ms: 60000,
    temperature: 0.2,
    confidence_threshold: 0.55,
    fallback_on_error: true,
    max_prompt_chars: 24000,
    write_brain_artifacts: true,
    claude_code: {
      command: 'claude',
      args: ['-p'],
      prompt_mode: 'stdin',
      timeout_ms: 90000,
      max_retries: 1,
      require_json: true,
      sanitize_api_env: true
    }
  },
  brain_routing: {
    enabled: true,
    // Brain-first: Claude is the thinking brain. Only genuinely trivial asks
    // (one-word tweaks) skip it; everything from `simple` upward thinks with
    // Claude. The heuristic is a true last-resort fallback, not a peer.
    external_min_difficulty: 'simple',
    require_brain_for_implementation: true,
    default_depth: 'auto',
    simple_asks_skip_external: false,
    depth_prompt_chars: { fast: 10000, standard: 18000, deep: 28000, architect: 42000 },
    difficulty_provider: { trivial: 'heuristic', simple: 'claude-code', medium: 'claude-code', complex: 'claude-code', epic: 'claude-code' },
    difficulty_depth: { trivial: 'fast', simple: 'standard', medium: 'standard', complex: 'deep', epic: 'architect' },
    difficulty_strategy: { trivial: 'direct', simple: 'direct', medium: 'deliberate', complex: 'deliberate', epic: 'tree' }
  },
  autonomy: {
    default_level: 3,
    allow_auto_fix: true,
    allow_auto_iteration: true,
    max_auto_iterations: 3,
    require_approval_for: [
      'visual_design',
      'database_schema',
      'auth',
      'payments',
      'destructive_changes',
      'architecture_changes',
      'deploy',
      'real_business_data',
      'global_playbook_updates'
    ]
  },
  execution: {
    enabled: true,
    auth: {
      mode: 'chatgpt',
      sanitize_api_env: true,
      require_chatgpt_login: true,
      blocked_env_keys: ['OPENAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']
    },
    primary: 'codex',
    fallback: 'claude',
    dry_run_when_missing_executor: true,
    timeout_ms: 900000,
    implementation_mode: 'staged-for-frontend-visual',
    codex: {
      command: 'codex',
      args: ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--config', 'approval_policy="never"', '-C']
    },
    claude: {
      command: 'claude',
      args: ['-p']
    }
  },
  usage_budget: {
    enabled: true,
    monthly_budget_usd: 10,
    warn_at_ratio: 0.8,
    hard_stop_at_ratio: 1.0,
    fallback_when_exceeded: true
  },
  validation: {
    commands: ['npm run lint', 'npm run typecheck', 'npm test', 'npm run build'],
    skip_missing_scripts: true
  },
  project_bootstrap: {
    enabled: true,
    ensure_validation_scripts: true,
    initialize_git_if_missing: true,
    create_initial_commit_if_empty: true
  },
  git_workflow: {
    enabled: true,
    branch_prefix: 'acf',
    base_branch: 'auto',
    require_git_repo: true,
    auto_create_branch: true,
    auto_commit_on_success: true,
    auto_merge_on_success: true,
    delete_branch_after_merge: false,
    require_clean_start: false
  },
  design: {
    default_provider: 'gpt-image',
    require_approval_for_frontend_visual: true,
    verify_provider_artifacts: true,
    never_fallback_to_recommended_when_user_supplied_id: true,
    quality: 'production-mock',
    creativity: 'creative-director',
    synthetic_assets: true,
    brand_bootstrap: true,
    gpt_image: {
      model: 'gpt-image-2',
      api_key_env: 'OPENAI_API_KEY',
      endpoint: 'https://api.openai.com/v1/images/generations',
      quality: 'medium',
      output_format: 'png',
      desktop_size: '1536x1024',
      mobile_size: '1024x1536',
      options: 3,
      require_confirm: true,
      estimated_cost_per_image_usd: 0.05
    },
    assets_required_for_production_mock: true,
    codex_generate_asset_pack: true,
    implementation_requires_real_assets: true,
    codex_generation_strategy: 'single-option-first',
    codex_default_option: 'option-a',
    codex_generate_missing_only: true,
    // v4.5 reliable Codex design pipeline:
    // Codex is a code agent and cannot create raster images. Ask it for
    // self-contained HTML mockups (its real capability) and let the harness
    // rasterize them to PNG with a local headless browser when available.
    codex_artifact_strategy: 'html-first',
    rasterize_html: true,
    html_renderer: null,
    accept_html_artifacts: true,
    min_png_bytes: 4096,
    min_html_bytes: 300,
    min_svg_bytes: 256,
    auto_fallback: true,
    fallback_chain: ['gpt-image-codex', 'gpt-image-api', 'wireframe-mock'],
    providers: {
      'manual-import': { kind: 'manual-import' },
      'wireframe-mock': { kind: 'wireframe-mock', options: 3, generate_mobile: true },
      'gpt-image': { kind: 'gpt-image-codex', require_real_image: true, staged: true },
      'gpt-image-codex': { kind: 'gpt-image-codex', require_real_image: true, staged: true },
      'gpt-image-api': { kind: 'gpt-image-api' },
      'external-command': { kind: 'external-command', command_env: 'ACF_DESIGN_COMMAND', args_env: 'ACF_DESIGN_COMMAND_ARGS', prompt_mode: 'stdin' }
    }
  },
  standards: {
    quality_profile: 'production',
    stack: 'next-nest-fullstack',
    frontend_target: 'WCAG 2.2 AA, Core Web Vitals conscious, production UI',
    backend_target: 'NestJS modular architecture, DTO validation, security baseline, proportional tests',
    dependency_policy: 'approval-required-for-heavy-or-risky-dependencies'
  },
  autonomous_loop: {
    mode: 'supervised',
    max_reqs_per_cycle: 1,
    max_auto_iterations: 3,
    allow_low_risk_auto_approve: false,
    allow_medium_risk_auto_approve: false,
    always_require_human_for: ['visual_design', 'auth', 'payments', 'database_schema', 'destructive_changes', 'deploy', 'real_business_data']
  },
  research: {
    default_provider: 'duckduckgo-html',
    max_results: 5,
    timeout_ms: 15000
  },
  components: {
    default_framework: 'react',
    write_design_component_plan: true
  },
  fake_data: {
    enabled: true,
    block_on_unconfirmed_real_data: true,
    scan_extensions: ['.tsx', '.ts', '.jsx', '.js', '.html', '.css', '.md'],
    scan_dirs: ['src/app', 'app', 'pages', 'components', 'public'],
    ignore_dirs: ['node_modules', '.git', '.ai', 'dist', 'build', '.next'],
    confirmed_real_data_patterns: [],
    allowed_placeholders: [
      'Email pendiente',
      'Teléfono pendiente',
      'Telefono pendiente',
      'Ubicación pendiente',
      'Ubicacion pendiente',
      'Contacto pendiente',
      '#contacto'
    ]
  },
  evolution: {
    enabled: true,
    auto_learn_on_close: true,
    auto_classify_failures: true,
    min_repeated_failures_for_proposal: 2,
    allow_autonomous_playbook_updates: false
  },
  dashboard: {
    host: '127.0.0.1',
    port: 3333,
    local_only: true
  }
};

export const DEFAULT_STATE = {
  version: VERSION,
  active_request_id: null,
  request_counter: 0,
  mode: 'balanced',
  autonomy_level: 3,
  created_at: null,
  updated_at: null
};

export const DIRECTORY_LAYOUT = [
  '.ai/backlog',
  '.ai/epics',
  '.ai/specs',
  '.ai/reasoning/intake',
  '.ai/reasoning/questions',
  '.ai/reasoning/context-packs',
  '.ai/reasoning/decisions',
  '.ai/reasoning/judgment',
  '.ai/reasoning/gates',
  '.ai/reasoning/risks',
  '.ai/reasoning/impact',
  '.ai/reasoning/acceptance',
  '.ai/reasoning/reviews',
  '.ai/reasoning/logs',
  '.ai/reasoning/brain',
  '.ai/context-cache',
  '.ai/execution/contracts',
  '.ai/execution/runs',
  '.ai/execution/status',
  '.ai/execution/logs',
  '.ai/evidence/packs',
  '.ai/memory/mistakes',
  '.ai/memory/learnings',
  '.ai/playbooks',
  '.ai/playbooks/versions',
  '.ai/definitions-of-done',
  '.ai/mcp/tool-routing',
  '.ai/designs/briefs',
  '.ai/designs/generated',
  '.ai/designs/imported',
  '.ai/designs/approved',
  '.ai/designs/rejected',
  '.ai/designs/reviews',
  '.ai/designs/manifests',
  '.ai/designs/comparisons',
  '.ai/designs/prompts',
  '.ai/designs/components',
  '.ai/designs/assets',
  '.ai/designs/creative-direction',
  '.ai/designs/interactions',
  '.ai/designs/motion',
  '.ai/designs/scores',
  '.ai/contracts/api',
  '.ai/contracts/ui',
  '.ai/contracts/fullstack',
  '.ai/standards',
  '.ai/adr',
  '.ai/reviews/frontend',
  '.ai/reviews/backend',
  '.ai/reviews/product',
  '.ai/reviews/security',
  '.ai/reviews/architecture',
  '.ai/autonomy/cycles',
  '.ai/autonomy/proposals',
  '.ai/research',
  '.ai/dashboard',
  '.ai/events',
  '.ai/history',
  '.ai/history/replays',
  '.ai/history/scores',
  '.ai/history/failures',
  '.ai/knowledge',
  '.ai/skills',
  '.ai/patterns',
  '.ai/improvements/proposals',
  '.ai/experiments',
  '.ai/feedback',
  '.ai/usage'
];

export const PROJECT_DNA = {
  identity: {
    name: 'AI Code Factory Project',
    description: 'Local-first Product Engineering OS project.',
    principle: 'Simple outside. Intelligent inside. Auditable always.'
  },
  stack: {
    frontend: 'Next.js',
    backend: 'NestJS',
    database: 'PostgreSQL',
    runtime: 'Node.js >=20',
    os: 'Windows/PowerShell friendly'
  },
  expected_architecture: {
    source_dirs: ['src', 'app', 'pages', 'components'],
    test_dirs: ['tests', 'test', '__tests__'],
    forbidden_in_source: ['hardcoded secrets', 'invented business data'],
    config_format: 'json'
  },
  quality_bar: {
    frontend_visual: 'premium, disciplined, no typographic gigantism, real visual evidence',
    backend: 'explicit contracts, validation, error cases, proportional tests',
    general: 'no green-build-only closes, evidence-driven'
  },
  must_not_do: [
    'invent phone numbers, emails, addresses, social links',
    'invent metrics, clients, years of experience or legal claims',
    'implement frontend visual work without approved design',
    'close visual work without visual acceptance',
    'change database/auth/payments/deploy without approval'
  ]
};

export const USER_PREFERENCES = {
  interface: 'simple CLI first: ask, next, preview, approve, status',
  autonomy: 'high autonomy behind the scenes with hard limits and gates',
  design: 'premium, sober, professional real-estate/product aesthetics',
  data_policy: 'never invent real business data; explicit placeholders only',
  platform: 'Windows + PowerShell + VS Code; Node.js only; no mandatory bash',
  config: 'JSON for critical config; avoid fragile YAML',
  executors: 'Codex primary, Claude fallback',
  stack: 'Next.js frontend, NestJS backend, PostgreSQL',
  communication: 'explain decisions, show evidence, allow approval before risky changes',
  updated_at: null,
  learned_rules: []
};

export const DESIGN_TASTE = `# Design Taste — learned preferences

- Real estate / product premium aesthetic: sober, contemporary, disciplined.
- No typographic gigantism; proportioned titles and controlled whitespace.
- Hero must communicate value in under 5 seconds with a visible CTA.
- Before/after galleries need 6-8 meaningful cases with comparison interaction.
- Professional, honest footers; explicit placeholders instead of invented data.
- Mobile usability is a first-class requirement, not an afterthought.

This file is updated by compile-memory and mine-feedback. Manual edits welcome.
`;

export const ENGINEERING_TASTE = `# Engineering Taste — learned preferences

- Simple interfaces, deep modules (A Philosophy of Software Design).
- Pure reasoning first, file writing second, CLI output last.
- JSON config, spawnSync with shell:false, args as arrays (Windows-safe).
- Tests proportional to risk; regression tests for every known failure.
- Evidence over claims: nothing closes on a green build alone.
- Low coupling between engines; no engine imports the CLI.

This file is updated by compile-memory and mine-feedback. Manual edits welcome.
`;

export const PLAYBOOKS = {
  'frontend-visual.md': `# Playbook — Frontend Visual

## Required steps
1. Intake.
2. Detect missing brand/content/assets.
3. Require design-first for landing, homepage, dashboard UI, portfolio or marketing pages.
4. Generate or import design.
5. Approve design explicitly.
6. Implement from approved design only.
7. Validate technically.
8. Run fake data scanner.
9. Run visual/quality/funnel review.
10. Require visual acceptance before done.

## Never
- Do not invent business data.
- Do not close only with build green.
- Do not ignore approved design.
- Do not fallback to recommended design if user selected another option.
`,
  'backend-api.md': `# Playbook — Backend API

## Required steps
1. Intake and classify entity/resource.
2. Clarify contract, validation, auth and persistence.
3. Define errors and edge cases.
4. Implement with tests proportional to risk.
5. Validate lint/typecheck/test/build.
6. Generate evidence pack.

## Never
- Do not change schema without approval.
- Do not weaken permissions.
- Do not hide failing tests.
`,
  'fullstack-feature.md': `# Playbook — Fullstack Feature

## Required steps
1. Split frontend/backend/contracts/data.
2. Define user flow.
3. Define API contract.
4. Define persistence.
5. Implement in safe slices.
6. Run smoke/e2e when available.
7. Generate evidence pack.
`,
  'bugfix.md': `# Playbook — Bugfix

## Required steps
1. Reproduce or infer failure.
2. Identify likely root cause.
3. Keep scope tight.
4. Add or update regression test when practical.
5. Validate.
6. Generate evidence.
`,
  'refactor.md': `# Playbook — Refactor

## Required steps
1. State behavior that must be preserved.
2. Identify tests protecting behavior.
3. Limit scope.
4. Refactor incrementally.
5. Validate.
6. Generate evidence.
`,
  'landing.md': `# Playbook — Landing Page

## Required criteria
- Hero communicates value in under 5 seconds.
- CTA is visible above the fold.
- Visual hierarchy is professional.
- Mobile is usable.
- Footer is complete and honest.
- No fake contact data, metrics or claims.
- Visual evidence is required.
`,
  'dashboard.md': `# Playbook — Dashboard

## Required criteria
- Clear overview.
- Actionable next step.
- Status and blockers visible.
- Logs accessible but summarized.
- No destructive actions without confirmation.
`
};

export const DEFINITIONS_OF_DONE = {
  'frontend-visual.json': {
    type: 'frontend_visual',
    required: [
      'technical_validation_passed',
      'approved_design_respected',
      'fake_data_gate_passed',
      'acceptance_criteria_passed',
      'responsive_review_passed',
      'visual_acceptance_passed'
    ],
    cannot_close_if: [
      'build_failed',
      'fake_data_detected',
      'approved_design_missing',
      'visual_acceptance_missing'
    ]
  },
  'backend-api.json': {
    type: 'backend_api',
    required: [
      'contract_defined',
      'validation_handled',
      'error_cases_covered',
      'tests_passed',
      'technical_validation_passed'
    ],
    cannot_close_if: ['tests_failed', 'contract_missing', 'security_risk_unreviewed']
  },
  'fullstack-feature.json': {
    type: 'fullstack_feature',
    required: ['contract_defined', 'frontend_done', 'backend_done', 'technical_validation_passed', 'smoke_validation_passed'],
    cannot_close_if: ['contract_missing', 'technical_validation_failed']
  },
  'bugfix.json': {
    type: 'bugfix',
    required: ['root_cause_identified', 'fix_applied', 'technical_validation_passed'],
    cannot_close_if: ['failure_unexplained', 'technical_validation_failed']
  },
  'refactor.json': {
    type: 'refactor',
    required: ['behavior_preserved', 'technical_validation_passed'],
    cannot_close_if: ['behavior_change_unapproved', 'technical_validation_failed']
  }
};

export const MCP_REGISTRY = {
  tools: [
    { name: 'filesystem', enabled: true, risk: 'medium', capabilities: ['read', 'write', 'list'], allowed_paths: ['src', 'app', 'pages', 'components', 'tests', '.ai', 'public'], blocked_paths: ['.env', '.git', 'node_modules'] },
    { name: 'playwright', enabled: false, risk: 'low', capabilities: ['screenshot', 'visual-check', 'browser-test'] },
    { name: 'browser-search', enabled: true, risk: 'low', capabilities: ['research', 'references', 'web-search'] },
    { name: 'figma', enabled: false, risk: 'medium', capabilities: ['read-design', 'export-assets'] },
    { name: 'image-generator', enabled: true, risk: 'medium', capabilities: ['design-generate', 'mock-wireframes', 'external-provider'], requires_approval_for: ['real-brand-assets'] },
    { name: 'component-generator', enabled: true, risk: 'low', capabilities: ['component-plan', 'ui-decomposition'] },
    { name: 'gpt-image', enabled: true, risk: 'medium', capabilities: ['production-mockups', 'synthetic-assets', 'brand-bootstrap', 'codex-design-provider'], requires_approval_for: [] },
    { name: 'senior-reviewer', enabled: true, risk: 'low', capabilities: ['frontend-review', 'backend-review', 'security-review', 'architecture-review'] },
    { name: 'autonomous-loop', enabled: true, risk: 'high', capabilities: ['product-scan', 'propose-features', 'cycle'], requires_approval_for: ['execute', 'close'] },
    { name: 'github', enabled: false, risk: 'high', capabilities: ['issues', 'pull-requests', 'commits'], requires_approval_for: ['write'] },
    { name: 'docs-search', enabled: false, risk: 'low', capabilities: ['documentation', 'api-reference'] },
    { name: 'design-provider', enabled: true, risk: 'medium', capabilities: ['generate-prompt-pack', 'manual-import', 'verify-artifacts'] },
    { name: 'database', enabled: false, risk: 'high', capabilities: ['schema-read', 'query-dev-db'], requires_approval_for: ['write', 'migrate'] }
  ]
};

export const KNOWN_FAILURES = [
  {
    id: 'KF-001',
    name: 'Design approval fallback bug',
    class: 'decision',
    pattern: 'User requested option-b but system approved option-a',
    prevention: 'Never fallback to recommended design if user supplied an explicit option id.',
    gate: 'approved_design_gate',
    test: 'design-approve option-b-desktop resolves option-b'
  },
  {
    id: 'KF-002',
    name: 'Fake business data',
    class: 'product',
    pattern: 'System invented phone, email, location, metrics or social links',
    prevention: 'Run fake data scanner before close and use explicit placeholders.',
    gate: 'fake_data_gate',
    test: 'fake data scanner detects phone/email/metrics'
  },
  {
    id: 'KF-003',
    name: 'Build green visual failure',
    class: 'visual',
    pattern: 'Frontend visual work closed with lint/typecheck/test/build but poor visual quality',
    prevention: 'Require visual evidence and visual acceptance for frontend visual work.',
    gate: 'visual_evidence_gate',
    test: 'no close if visual acceptance missing'
  },
  {
    id: 'KF-004',
    name: 'Weak quality command',
    class: 'planning',
    pattern: 'quality returned static rubric instead of analyzing implementation',
    prevention: 'Quality engine must inspect artifacts, gates and acceptance criteria.',
    gate: 'acceptance_criteria_gate',
    test: 'quality reads real state'
  },
  {
    id: 'KF-005',
    name: 'Bad Codex invocation',
    class: 'executor',
    pattern: 'Codex invoked without exec causing stdin is not a terminal',
    prevention: 'Always invoke codex exec with args array and shell:false.',
    gate: 'executor_status_gate',
    test: 'executor command builder includes exec'
  }
];

export const FAILURE_CLASSES = [
  'technical', 'visual', 'product', 'planning', 'context', 'tool', 'executor', 'decision', 'user_input_gap'
];

export const QUALITY_RUBRIC = `# Quality Rubric

Quality is not a static checklist. Commands must inspect current artifacts and evidence.

## Frontend visual
- Communicates value quickly.
- CTA visible.
- Good visual hierarchy.
- No gigantism.
- Responsive and mobile usable.
- Approved design respected.
- No fake data.
- Visual acceptance exists.

## Backend
- Clear contract.
- Validation and errors handled.
- Tests proportional to risk.
- No security regression.
- Evidence generated.
`;
