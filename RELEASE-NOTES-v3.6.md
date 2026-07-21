# AI Code Factory v3.6.0 — Connected MCP Suite

## New in this version

### 1) Connected design providers
- `design-generate` is no longer only a prompt-pack writer.
- Added pluggable provider model:
  - `manual-import`
  - `wireframe-mock` (built-in, generates real desktop/mobile SVG artifacts)
  - `gpt-image` (external-command bridge)
  - `external-command` (generic bridge for custom MCP/CLI integrations)
- Manifest now reflects actual generated artifacts when they exist.

### 2) MCP tool management
- `npm run ai -- mcp list`
- `npm run ai -- mcp enable <tool>`
- `npm run ai -- mcp disable <tool>`
- `npm run ai -- mcp doctor`
- Registry expanded with `image-generator` and `component-generator`.

### 3) Component planning
- Added `npm run ai -- component-plan [REQ-XXX]`
- Produces `.ai/designs/components/<REQ>-component-plan.md`
- Helps translate approved UI/design into a clean component breakdown.

### 4) Web research
- Added `npm run ai -- research-web "query"`
- Stores outputs under `.ai/research/`
- Uses a lightweight DuckDuckGo HTML research provider.

### 5) Richer design prompt packs
- Design prompt pack now includes:
  - design brief
  - user answers
  - context pack excerpt
  - explicit output contract
  - stricter visual requirements

## Recommended local setup

### Fastest zero-API design path
```bash
npm run ai -- design-provider set wireframe-mock
npm run ai -- design-generate
```
This gives you real mock design artifacts without external billing.

### External image provider bridge
Configure an external CLI or MCP wrapper and then:
```bash
npm run ai -- design-provider set gpt-image
npm run ai -- design-generate
```
The external tool must create the target files declared in the job JSON.

## Notes
- The built-in `wireframe-mock` provider is for fast design iteration and testing.
- The `gpt-image` provider is intentionally implemented as a safe bridge layer so you can integrate your own CLI/MCP wrapper without hardcoding billing assumptions into the harness.
