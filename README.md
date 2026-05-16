<!-- sync with README.zh.md — keep both files in sync -->

# deepseek2responses

Convert DeepSeek API to OpenAI Responses API. Run locally, plug into any tool that speaks Responses API (Codex, etc.).

## Quick start

```bash
uv tool install deepseek2responses
deepseek2responses
```

Or from source:

```bash
git clone https://github.com/Lhy723/deepseek2responses && cd deepseek2responses
uv tool install .
deepseek2responses
```

First run prompts for your DeepSeek API key and saves to `~/.deepseek2responses/config.yaml`. Subsequent runs just `deepseek2responses`.

Or run directly without installing:

```bash
export DEEPSEEK_API_KEY=sk-your-deepseek-key
uv run deepseek2responses
```

Output:

```text
Proxy API key: dH7kXp2m...
Bind:     http://0.0.0.0:19199
Endpoint: http://127.0.0.1:19199/v1/responses
```

## Configure Codex

Manually edit the two files below, or use [cc-switch](https://github.com/farion1231/cc-switch) to manage providers via GUI.

**~/.codex/auth.json:**

```json
{"OPENAI_API_KEY": "deepseek"}
```

**~/.codex/config.toml:**

```toml
model = "deepseek-v4-pro"
model_provider = "deepseek"
model_context_window = 1000000
model_max_output_tokens = 393216
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.deepseek]
name = "DeepSeek"
base_url = "http://127.0.0.1:19199/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
```

Start proxy:

```bash
uv run deepseek2responses --no-auth
```

Then completely quit Codex (menu bar → Quit) and reopen.

## FAQ

### Codex desktop can't connect (502 Bad Gateway)

Codex desktop on macOS has local network permission issues. Workaround:

1. Turn VPN on
2. Launch Codex desktop
3. Turn VPN off
4. Use Codex normally

Repeat this flow each time you restart Codex.

## Config file

Config stored at `~/.deepseek2responses/config.yaml`. First run creates it automatically. Edit manually for advanced settings:

```yaml
deepseek_api_key: "sk-your-key"
host: "127.0.0.1"
# port: 19199
# api_key: "fixed-proxy-key"
# model_mapping:
#   "gpt-4.1": "deepseek-v4-pro"
```

Use `--config` for a custom path.

## CLI options

```text
--config, -c    Path to config file
--port, -p      Override server port
--no-auth       Disable proxy API key auth
--version, -v   Show version
```

## How it works

Receives OpenAI Responses API requests, converts to DeepSeek Chat Completions API (`/v1/chat/completions`), and converts responses back. Supports multi-turn conversation, tool calling, and thinking/reasoning mode.
