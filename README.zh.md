<!-- sync with README.md — 中英文保持同步 -->

<p align="right"><a href="README.md">English</a></p>

<h1 align="center">deepseek2responses</h1>
<p align="center">
  <a href="https://pypi.org/project/deepseek2responses"><img src="https://img.shields.io/pypi/v/deepseek2responses?label=PyPI" alt="PyPI"></a>
  <a href="https://github.com/Lhy723/deepseek2responses"><img src="https://img.shields.io/badge/GitHub-deepseek2responses-blue" alt="GitHub"></a>
  <a href="https://pypi.org/project/deepseek2responses"><img src="https://img.shields.io/pypi/pyversions/deepseek2responses" alt="Python"></a>
</p>
<p align="center">把 DeepSeek API 转成 OpenAI Responses API 端点。<strong>一行安装，一行启动。</strong></p>

---

## 快速开始

```bash
uv tool install deepseek2responses
deepseek2responses
```

首次运行提示输入 DeepSeek API key，保存至 `~/.deepseek2responses/config.yaml`。之后只需 `deepseek2responses`。

```text
Proxy API key: dH7kXp2m...
Bind:     http://0.0.0.0:19199
Endpoint: http://127.0.0.1:19199/v1/responses
```

## 配置 Codex

编辑下面两个文件，或用 [cc-switch](https://github.com/farion1231/cc-switch) 图形化管理。

`.codex/auth.json`：

```json
{"OPENAI_API_KEY": "deepseek"}
```

`.codex/config.toml`：

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

启动并使用：

```bash
deepseek2responses --no-auth
# Codex 菜单栏完全退出，再重开
```

## 常见问题

### Codex 桌面端连不上（502）

macOS Codex 桌面端存在本地网络权限问题。解决方法：开启 VPN → 启动 Codex → 关闭 VPN → 正常使用。每次重启 Codex 都需重复。

## 配置

配置文件保存在 `~/.deepseek2responses/config.yaml`，首次运行自动创建。高级设置可手动编辑：

```yaml
deepseek_api_key: "sk-你的-key"
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

## 原理

```text
Codex → POST /v1/responses → deepseek2responses
  → POST https://api.deepseek.com/v1/chat/completions
  → 转换回 Responses API → Codex
```

支持流式输出、多轮对话、工具调用（含 `local_shell`）、DeepSeek V4 推理/思维链模式。

## 环境要求

Python 3.12+ | [DeepSeek API key](https://platform.deepseek.com/api_keys)
