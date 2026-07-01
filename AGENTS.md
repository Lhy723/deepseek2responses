# AGENTS.md

## Project overview
- `deepseek2responses` is a Node.js 20+/TypeScript proxy and Electron dashboard for exposing an OpenAI Responses-compatible endpoint backed by DeepSeek Chat Completions (`/v1/chat/completions`).
- CLI command is `deepseek2responses`; default endpoint is `POST /v1/responses` on port `19199`. `--desktop` launches the Electron dashboard.
- Keep `README.md` and `README.zh.md` in sync when changing user-facing behavior or setup docs.

## Repository layout
- `src/cli.ts` — CLI, first-run config wizard, `--setup`, server/desktop startup.
- `src/core/config.ts` — YAML config loading/saving; `DEEPSEEK_API_KEY` env fallback.
- `src/core/converter.ts` — Responses ↔ DeepSeek conversion, SSE event conversion, tool/reasoning handling.
- `src/core/responses-store.ts` — in-memory `previous_response_id` cache and cache hit/miss stats.
- `src/core/stats-store.ts` — append-only JSONL request/token/cache statistics.
- `src/server/create-server.ts` — Fastify routes, proxy auth, upstream HTTP handling, dashboard APIs.
- `src/electron/` — Electron main/preload process.
- `src/renderer/` — React dashboard UI.
- `tests/` — Vitest coverage for config, converter, router, and stats.

## Commands
- Install dependencies: `npm install`
- Run proxy in dev: `npm run dev -- --config config.yaml --port 19199`
- Run without proxy auth for local Codex testing: `npm run dev -- --no-auth`
- Launch desktop in dev: `npm run dev:desktop`
- Run tests: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`

## Architecture and invariants
- Flow: client `POST /v1/responses` → Fastify route → `DeepSeekConverter.convertRequest()` → DeepSeek `/chat/completions` → `convertResponse()` or `convertStream()` → client.
- DeepSeek V4 thinking mode is enabled by default. Put `reasoning_effort` inside `thinking`; strip `temperature` and `top_p`; `reasoning.effort === "high"` maps to DeepSeek `"max"`, other efforts map to `"high"`.
- Responses `max_output_tokens` must map to DeepSeek `max_tokens`, not `max_completion_tokens`.
- Reasoning is round-tripped through Responses `encrypted_content` and DeepSeek `reasoning_content`; preserve this when changing multi-turn behavior.
- Tool-message validity matters: orphan tool outputs are removed and missing tool outputs are synthesized before upstream calls.
- Codex-priority tool support is intentionally limited: function/local_shell/custom/namespace are supported; hosted tools and `input_file` should fail clearly instead of being silently dropped.
- `previous_response_id` cache stores conversation messages without inherited system instructions. Both streaming and non-streaming responses should update cache when `store !== false`.
- Stats are append-only JSONL at `~/.deepseek2responses/stats.jsonl` by default; never log full API keys.

## Config and security notes
- Default config lives at `~/.deepseek2responses/config.yaml`; `config.yaml` in the repo is local-only and must not contain committed real secrets.
- Proxy auth uses the configured DeepSeek key as `Authorization: Bearer ...` unless `--no-auth` is set.
- Config file value takes precedence over `DEEPSEEK_API_KEY` fallback.
- Dashboard/runtime APIs must mask API keys and avoid exposing secrets when bound beyond localhost.
