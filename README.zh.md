<!-- sync with README.md - 中英文保持同步 -->

<p align="right"><a href="README.md">English</a></p>

<p align="center">
  <img src="assets/icon.svg" width="112" height="112" alt="deepseek2responses 图标" />
</p>

<h1 align="center">deepseek2responses</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="build" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="node" />
</p>

<p align="center">
  <em>一个本地 DeepSeek 到 OpenAI Responses API 代理，并内置 Electron 仪表盘查看 token 用量与缓存分析。</em>
</p>

## 项目简介

`deepseek2responses` 暴露 OpenAI Responses 兼容端点，并将请求转发到 DeepSeek Chat Completions。它面向 Codex 和其他 Responses API 客户端，重点保证本地代理行为、工具调用转换、推理内容回传和 `previous_response_id` 支持足够稳定可预期。

**核心特性：**

- 🚀 **高性能本地代理**：运行在 `127.0.0.1`，只转发规范化后的上游请求，并支持 SSE 流式输出
- 🛠 **易用性**：首次运行自动配置 API Key，一条 CLI 命令即可启动，也可打开桌面仪表盘
- 🔌 **Codex 兼容**：支持 function tools、`local_shell`、`custom`、namespace tools 和 Responses 风格事件
- 📦 **聚焦依赖**：Node.js 20+、Fastify、React、Electron，以及小而清晰的转换模块

## 示例 / 截图

<p align="center">
  <img src="screenshots/dashboard.png" width="90%" alt="deepseek2responses 仪表盘截图" />
</p>

<details>
<summary><b>CLI 输出</b></summary>

```text
$ deepseek2responses --no-auth
deepseek2responses v0.1.0
WARNING: auth disabled (--no-auth)
Bind:     http://127.0.0.1:19199
Endpoint: http://127.0.0.1:19199/v1/responses
Dashboard: http://127.0.0.1:19199/dashboard/
```
</details>

## 安装指南

### 环境要求

- Node.js >= 20
- macOS、Linux 或 Windows
- DeepSeek API Key

### 安装方式

<details open>
<summary><b>方式一：通过 npm 安装</b></summary>

```bash
npm install -g deepseek2responses
deepseek2responses
```
</details>

<details>
<summary><b>方式二：从源码安装</b></summary>

```bash
git clone https://github.com/Lhy723/deepseek2responses.git
cd deepseek2responses
npm install
npm run build
npm start
```
</details>

## 使用文档

### 快速上手

```bash
deepseek2responses
```

首次运行会询问 DeepSeek API Key，并保存到 `~/.deepseek2responses/config.yaml`。

本地地址：

```text
Proxy:     http://127.0.0.1:19199
Endpoint:  http://127.0.0.1:19199/v1/responses
Dashboard: http://127.0.0.1:19199/dashboard/
```

启动桌面仪表盘：

```bash
deepseek2responses --desktop
```

本地 Codex 测试时关闭代理鉴权：

```bash
deepseek2responses --no-auth
```

### 核心概念

- **请求转换**：Responses 请求会转换为 DeepSeek `/v1/chat/completions` payload。
- **推理保留**：Responses `encrypted_content` 会通过 DeepSeek `reasoning_content` 跨轮回传。
- **Thinking 模式**：DeepSeek V4 thinking 默认启用。`reasoning.effort = "high"` 映射为 DeepSeek `"max"`，其他 effort 映射为 `"high"`。
- **Token 映射**：Responses `max_output_tokens` 映射为 DeepSeek `max_tokens`。
- **对话缓存**：当 `store !== false` 时，`previous_response_id` 使用内存缓存。
- **工具安全**：不支持的 hosted tools 和 `input_file` 会按配置明确失败或丢弃。

### API / 配置项一览

<details open>
<summary><b>配置项</b></summary>

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `deepseek_api_key` | `string` | `""` | DeepSeek API Key；除非使用 `--no-auth`，也会作为本地代理 bearer token |
| `deepseek_base_url` | `string` | `https://api.deepseek.com/v1` | DeepSeek 兼容上游 base URL |
| `host` | `string` | `127.0.0.1` | 本地 Fastify 绑定 host |
| `port` | `number` | `19199` | 本地代理端口 |
| `timeout` | `number` | `300` | 上游请求超时时间，单位秒 |
| `model_mapping` | `object` | DeepSeek V4 映射 | 客户端模型到上游模型的映射 |
| `max_output_tokens_cap` | `number` | `393216` | 转发 `max_output_tokens` 前应用的上限 |
| `unsupported_tools` | `"drop" \| "error"` | `drop` | 如何处理不支持的 hosted tools |
| `tool_name_sanitize` | `boolean` | `true` | 转发前清理 function/MCP 工具名 |
| `stats_file` | `string` | `~/.deepseek2responses/stats.jsonl` | append-only 请求统计文件 |
| `log_file` | `string` | `~/.deepseek2responses/app.log` | 诊断日志文件 |

</details>

<details>
<summary><b>CLI 参数</b></summary>

| 命令 | 说明 |
|------|------|
| `deepseek2responses` | 启动本地代理 |
| `deepseek2responses --desktop` | 启动 Electron 仪表盘 |
| `deepseek2responses --setup` | 打印 Codex 配置片段并退出 |
| `deepseek2responses --config ./config.yaml` | 使用自定义配置路径 |
| `deepseek2responses --port 19199` | 覆盖配置中的端口 |
| `deepseek2responses --no-auth` | 禁用本地代理鉴权 |
| `deepseek2responses --version` | 打印包版本 |

</details>

### 进阶用法

<details>
<summary><b>配置 Codex</b></summary>

`.codex/auth.json`：

```json
{"OPENAI_API_KEY": "sk-your-deepseek-key"}
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

修改 Codex 配置后，请完全退出并重新打开 Codex。
</details>

<details>
<summary><b>配置文件示例</b></summary>

```yaml
deepseek_api_key: "sk-your-key"
# deepseek_base_url: "https://api.deepseek.com/v1"
# host: "127.0.0.1"
# port: 19199
# timeout: 300
# max_output_tokens_cap: 393216
# unsupported_tools: "drop"
# tool_name_sanitize: true
# model_mapping:
#   "deepseek-v4-pro": "deepseek-v4-pro"
#   "deepseek-v4-flash": "deepseek-v4-flash"
```

环境变量：

| 变量 | 说明 |
|------|------|
| `DEEPSEEK2RESPONSES_CONFIG` | 自定义配置文件路径 |
| `DEEPSEEK_API_KEY` | 当配置文件未包含 API Key 时作为 fallback |

配置文件优先级高于 `DEEPSEEK_API_KEY`。
</details>

<details>
<summary><b>兼容范围</b></summary>

已支持：

- `POST /v1/responses` 和 `/responses`
- 文本输入、message 数组和 `instructions`
- 非流式与 SSE 流式输出
- `previous_response_id`
- function tools、`local_shell`、`custom`、namespace tools 和 function call outputs
- `text.format.type = "json_object"`，以及降级处理的 `json_schema`
- token usage、reasoning tokens 和 DeepSeek prompt-cache token 统计

暂不完整支持：

- `file_search`、`web_search_preview`、`computer_use_preview`、`code_interpreter`、`image_generation` 等 hosted tools
- `input_file` 和图片 `file_id`
- GET、DELETE、CANCEL response 等完整 response 管理端点
</details>

## 本地开发

```bash
git clone https://github.com/Lhy723/deepseek2responses.git
cd deepseek2responses

npm install
npm run dev -- --config config.yaml --port 19199
npm test
npm run typecheck
npm run build
```

桌面开发：

```bash
npm run dev:desktop
```

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

## Star 趋势

[![Star History Chart](https://api.star-history.com/svg?repos=Lhy723/deepseek2responses&type=Date)](https://star-history.com/#Lhy723/deepseek2responses&Date)

<p align="center">
  <sub>Built with love by <a href="https://github.com/Lhy723">Lhy723</a></sub>
</p>
