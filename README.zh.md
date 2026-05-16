<!-- sync with README.md — 中英文保持同步 -->

# deepseek2responses

将 DeepSeek API 转为 OpenAI Responses API。本地运行，接入任意支持 Responses API 的工具（Codex 等）。

## 快速开始

```bash
git clone <repo> && cd deepseek2responses
uv tool install .
deepseek2responses
```

首次运行提示输入 DeepSeek API key，保存到 `~/.deepseek2responses/config.yaml`。之后只需 `deepseek2responses` 一条命令。

也可不装直接跑：

```bash
export DEEPSEEK_API_KEY=sk-你的-deepseek-key
uv run deepseek2responses
```

输出：

```text
Proxy API key: dH7kXp2m...
Bind:     http://0.0.0.0:19199
Endpoint: http://127.0.0.1:19199/v1/responses
```

## 配置 Codex

手动编辑下面两个文件，或使用 [cc-switch](https://github.com/farion1231/cc-switch) 图形化管理 provider。

**~/.codex/auth.json：**

```json
{"OPENAI_API_KEY": "deepseek"}
```

**~/.codex/config.toml：**

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

启动代理：

```bash
uv run deepseek2responses --no-auth
```

Codex 菜单栏完全退出后重开。

## 常见问题

### Codex 桌面端连不上代理（502 Bad Gateway）

macOS 上 Codex 桌面端存在本地网络权限问题。解决步骤：

1. 开启 VPN
2. 启动 Codex 桌面端
3. 关闭 VPN
4. 正常使用 Codex

每次重启 Codex 前都需要重复此流程。

## 配置文件

配置保存在 `~/.deepseek2responses/config.yaml`，首次运行自动创建。高级设置可手动编辑：

```yaml
deepseek_api_key: "sk-你的-key"
host: "127.0.0.1"
# port: 19199
# api_key: "fixed-proxy-key"
# model_mapping:
#   "gpt-4.1": "deepseek-v4-pro"
```

自定义路径用 `--config`。

## CLI 选项

```text
--config, -c    配置文件路径
--port, -p      覆盖端口
--no-auth       关闭代理 API key 校验
--version, -v   显示版本
```

## 原理

接收 OpenAI Responses API 请求，转为 DeepSeek Chat Completions API（`/v1/chat/completions`），再将响应转回 Responses API 格式。支持多轮对话、工具调用、思考/推理模式。
