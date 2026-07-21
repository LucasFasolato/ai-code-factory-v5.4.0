# AI Code Factory v3.7.0 — Senior Autonomous Product Engineering OS

## Focus
This release turns the harness into a more senior, product-grade engineering OS:

- Senior Creative Design Engine with GPT Image provider support.
- Production-mock design quality mode.
- Creative-director mode for synthetic branding/copy/assets.
- Standards/conventions system for frontend and backend.
- Quality profiles: prototype, MVP, production, enterprise.
- Feature proposal engine and supervised autonomous loop.
- Senior reviews for frontend, backend, product, security and architecture.
- API contract and ADR generators.

## Design
Use GPT Images:

```powershell
npm run ai -- design-provider set gpt-image
npm run ai -- design-quality set production-mock
npm run ai -- design-creativity set creative-director
npm run ai -- design-cost-preview
npm run ai -- design-generate --confirm
```

Without `--confirm`, gpt-image generation writes prompt/cost artifacts but does not spend API credits.

## Autonomy

```powershell
npm run ai -- product-scan
npm run ai -- propose-features
npm run ai -- autonomous-cycle --mode supervised
```

The loop proposes, analyzes and advances only within explicit gates. Human approval remains required for visual design approval, payments, auth, database schema, deploy, destructive changes and real business data.

## Standards

```powershell
npm run ai -- standards init production
npm run ai -- quality-profile set production
npm run ai -- frontend-review
npm run ai -- backend-review
npm run ai -- security-review
npm run ai -- architecture-review
```

## Honest limitations
- GPT Image generation requires `OPENAI_API_KEY` and API billing.
- The built-in heuristic reviews are deterministic senior checklists, not a replacement for human review.
- Full autonomous execution still respects hard gates and will stop for high-risk/human-only decisions.
