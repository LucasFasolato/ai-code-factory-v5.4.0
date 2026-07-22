# Questions — REQ-001

## Pending questions



## Blocking missing information

- database/schema approval

## Allowed assumptions

- state assumptions explicitly
- prefer safe defaults
- do not invent real-world claims
- Alias mapping is case-insensitive and trimmed (e.g. 'Node-TypeScript-CLI' also normalizes) unless existing normalization conventions in the codebase say otherwise — state this assumption in the implementation.
- internal-tool is confirmed to already exist as a valid enum member of PROJECT_TYPES (per the ask); implementation should verify this and fail loudly if not.
