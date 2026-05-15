# deepseek2responses Design Spec

## Overview

A lightweight local proxy that converts DeepSeek Chat Completions API and Anthropic Messages API into OpenAI Responses API format. Single-process Python service with YAML config + CLI interaction.

## Architecture

```
Client → POST /v1/responses → deepseek2responses proxy → Upstream API (DeepSeek/Anthropic)
                                      ↓
                              Response conversion → OpenAI Responses API format → Client
```

Core components:
- **FastAPI server**: Receives Responses API requests, returns Responses API responses
- **Converter layer**: Abstract base + provider-specific converters (DeepSeek, Anthropic)
- **httpx client**: Async HTTP client for upstream API calls (streaming + non-streaming)
- **Config loader**: YAML config with provider settings and model mapping

## Tech Stack

- Python 3.11+
- FastAPI + uvicorn (web framework + ASGI server)
- httpx (async HTTP client)
- PyYAML (config parsing)
- Pydantic (request/response models, included with FastAPI)

## Project Structure

```
deepseek2responses/
├── pyproject.toml
├── config.example.yaml
├── src/
│   └── deepseek2responses/
│       ├── __init__.py
│       ├── main.py            # CLI entry + FastAPI app
│       ├── config.py           # Config loading & validation
│       ├── models.py           # Pydantic request/response models
│       ├── routers/
│       │   ├── __init__.py
│       │   └── responses.py    # /v1/responses route
│       └── converters/
│           ├── __init__.py
│           ├── base.py         # Abstract converter base class
│           ├── deepseek.py     # DeepSeek converter
│           └── anthropic.py    # Anthropic converter
```

## Configuration (config.yaml)

```yaml
server:
  host: "0.0.0.0"
  port: 8080

providers:
  deepseek:
    api_key: "sk-xxx"
    base_url: "https://api.deepseek.com"
    model_mapping:
      "gpt-4.1": "deepseek-chat"
      "gpt-4.1-mini": "deepseek-chat"
      "o3-mini": "deepseek-reasoner"

  anthropic:
    api_key: "sk-ant-xxx"
    base_url: "https://api.anthropic.com"
    model_mapping:
      "gpt-4.1": "claude-sonnet-4-20250514"
      "gpt-4.1-mini": "claude-3-5-haiku-20241022"

default_provider: "deepseek"
```

Provider can be overridden per-request via `X-Provider` header.

## Request Conversion

### Field Mapping

| Responses API | DeepSeek Chat Completions | Anthropic Messages |
|---|---|---|
| `input` (string) | `messages: [{role: "user", content: input}]` | `messages: [{role: "user", content: input}]` |
| `input` (array) | Map to `messages` directly | Map to `messages` directly |
| `instructions` | `system: instructions` | `system: instructions` |
| `model` | Via `model_mapping` | Via `model_mapping` |
| `temperature` | `temperature` | `temperature` |
| `top_p` | `top_p` | `top_p` |
| `max_output_tokens` | `max_tokens` | `max_tokens` |
| `stream` | `stream` | `stream` |
| `tools` (function) | `tools` (format convert) | `tools` (format convert) |
| `tool_choice` | `tool_choice` | `tool_choice` |
| `previous_response_id` | Ignored (stateless) | Ignored (stateless) |

### Input Content Type Conversion

| Responses API | DeepSeek | Anthropic |
|---|---|---|
| `input_text` | `type: "text"` | `type: "text"` |
| `input_image` (url) | `type: "image_url", image_url: {url}` | `type: "image", source: {type: "url", url}` |
| `input_image` (base64) | `type: "image_url", image_url: {url: "data:..."}` | `type: "image", source: {type: "base64", ...}` |

## Response Conversion

### Non-streaming

**DeepSeek → Responses API**:
- `choices[0].message.content` → `output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }]`
- `choices[0].message.tool_calls` → `output: [{ type: "function_call", id, call_id, name, arguments }]`
- `usage` → `usage: { input_tokens, output_tokens, total_tokens }`

**Anthropic → Responses API**:
- `content[0].text` → `output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }]`
- `content[0].type == "tool_use"` → `output: [{ type: "function_call", id, call_id, name, arguments }]`
- `usage` → `usage: { input_tokens, output_tokens, total_tokens }`

### Streaming

**DeepSeek SSE → Responses API SSE**:

| DeepSeek Event | Responses API Event |
|---|---|
| First chunk | `response.created` + `response.in_progress` + `response.output_item.added` + `response.content_part.added` |
| `choices[0].delta.content` | `response.output_text.delta` |
| `choices[0].delta.tool_calls` | `response.function_call_arguments.delta` |
| `[DONE]` | `response.output_text.done` + `response.content_part.done` + `response.output_item.done` + `response.completed` |

**Anthropic SSE → Responses API SSE**:

| Anthropic Event | Responses API Event |
|---|---|
| `message_start` | `response.created` + `response.in_progress` + `response.output_item.added` + `response.content_part.added` |
| `content_block_delta` (text) | `response.output_text.delta` |
| `content_block_delta` (tool_use) | `response.function_call_arguments.delta` |
| `message_delta` (stop) | `response.output_text.done` + `response.content_part.done` + `response.output_item.done` + `response.completed` |

## Tool Support

| Tool Type | DeepSeek | Anthropic | Strategy |
|---|---|---|---|
| `function` calling | Supported | Supported | Full conversion |
| `web_search_preview` | Not supported | Not supported | Silently filter out |
| `file_search` | Not supported | Not supported | Silently filter out |
| `code_interpreter` | Not supported | Not supported | Silently filter out |

Only `function` type tools are forwarded to upstream. Unsupported built-in tool types are silently removed during request conversion.

## ID Generation

Stateless proxy generates IDs locally:
- Response ID: `resp_` + 24 hex chars
- Message ID: `msg_` + 24 hex chars
- Function call ID: `fc_` + 24 hex chars

## Error Handling

| Scenario | Response |
|---|---|
| Upstream 4xx/5xx | Convert to Responses API error format with original message |
| Upstream timeout | 504 Gateway Timeout |
| Upstream unreachable | 502 Bad Gateway |
| Invalid request format | 400 Bad Request with details |
| Unsupported model | 404 with available model list |
| Unsupported tool type | Silently filter, no error |

Error response format:
```json
{
  "error": {
    "code": "provider_error",
    "message": "DeepSeek API returned 429: Rate limit exceeded"
  }
}
```

## CLI

```bash
# Start with default config
deepseek2responses

# Specify config file
deepseek2responses --config /path/to/config.yaml

# Specify port
deepseek2responses --port 9090

# Version
deepseek2responses --version
```

Startup output:
```
deepseek2responses v0.1.0
Config loaded from config.yaml
Provider: deepseek (default)
Listening on http://0.0.0.0:8080
API docs: http://0.0.0.0:8080/docs
```

## Testing

- pytest + httpx AsyncClient for integration tests
- Mock upstream API responses to verify conversion correctness
- Coverage: non-streaming conversion, streaming conversion, error handling, model mapping
