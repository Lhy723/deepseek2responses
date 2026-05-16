<!-- sync with README.zh.md — keep both files in sync -->

<p align="right"><a href="README.zh.md">中文</a></p>

<h1 align="center">deepseek2responses</h1>
<p align="center">
  <a href="https://pypi.org/project/deepseek2responses"><img src="https://img.shields.io/pypi/v/deepseek2responses?label=PyPI" alt="PyPI"></a>
  <a href="https://github.com/Lhy723/deepseek2responses"><img src="https://img.shields.io/badge/GitHub-deepseek2responses-blue" alt="GitHub"></a>
  <a href="https://pypi.org/project/deepseek2responses"><img src="https://img.shields.io/pypi/pyversions/deepseek2responses" alt="Python"></a>
</p>
<p align="center">Turn DeepSeek API into an OpenAI Responses API endpoint. <strong>One command install, one command run.</strong></p>

---

## Quick Start

```bash
uv tool install deepseek2responses
deepseek2responses
```

First run asks for your DeepSeek API key, saves to `~/.deepseek2responses/config.yaml`. After that, just `deepseek2responses`.

```text
Proxy API key: dH7kXp2m...
Bind:     http://0.0.0.0:19199
Endpoint: http://127.0.0.1:19199/v1/responses
```

## Configure Codex

Write two files, or use [cc-switch](https://github.com/farion1231/cc-switch) GUI.

`.codex/auth.json`:

```json
{"OPENAI_API_KEY": "deepseek"}
```

`.codex/config.toml`:

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

Start and use:

```bash
deepseek2responses --no-auth
# Completely quit Codex (menu bar → Quit), reopen.
```

## FAQ

### Codex desktop can't connect (502)

macOS Codex desktop has local network permission issues. Workaround: turn VPN on → launch Codex → turn VPN off → use normally. Repeat this on every restart.

## Config

Persisted at `~/.deepseek2responses/config.yaml`. Edit for advanced settings:

```yaml
deepseek_api_key: "sk-your-key"
host: "127.0.0.1"
# port: 19199
# api_key: "fixed-proxy-key"
# model_mapping:
#   "gpt-4.1": "deepseek-v4-pro"
```

## CLI

| Flag | Description |
| --- | --- |
| `--config`, `-c` | Custom config path |
| `--port`, `-p` | Override port |
| `--no-auth` | Disable proxy auth |
| `--version`, `-v` | Print version |

## How It Works

```text
Codex → POST /v1/responses → deepseek2responses
  → POST https://api.deepseek.com/v1/chat/completions
  → convert back → Codex
```

Supports streaming, multi-turn conversation, tool calling (including `local_shell`), and DeepSeek V4 reasoning/thinking mode.

## Requirements

Python 3.12+ | [DeepSeek API key](https://platform.deepseek.com/api_keys)
