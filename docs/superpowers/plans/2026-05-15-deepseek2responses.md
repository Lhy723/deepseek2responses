# deepseek2responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight local proxy that converts DeepSeek Chat Completions API and Anthropic Messages API into OpenAI Responses API format.

**Architecture:** FastAPI server with httpx async client, pluggable converter layer (base + DeepSeek + Anthropic), YAML config + CLI entry.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, httpx, PyYAML, Pydantic, pytest, pytest-asyncio

---

## File Structure

| File | Responsibility |
|---|---|
| `pyproject.toml` | Project metadata, dependencies, CLI entrypoint |
| `config.example.yaml` | Example configuration file |
| `src/deepseek2responses/__init__.py` | Package init, version |
| `src/deepseek2responses/config.py` | Config loading from YAML, Pydantic models |
| `src/deepseek2responses/models.py` | Pydantic models for Responses API request/response |
| `src/deepseek2responses/converters/base.py` | Abstract base class for all converters |
| `src/deepseek2responses/converters/deepseek.py` | DeepSeek Chat Completions → Responses API |
| `src/deepseek2responses/converters/anthropic.py` | Anthropic Messages → Responses API |
| `src/deepseek2responses/routers/responses.py` | FastAPI route handler for `/v1/responses` |
| `src/deepseek2responses/main.py` | CLI entrypoint, FastAPI app factory |
| `tests/test_config.py` | Config loading tests |
| `tests/test_models.py` | Pydantic model tests |
| `tests/test_deepseek_converter.py` | DeepSeek converter unit tests |
| `tests/test_anthropic_converter.py` | Anthropic converter unit tests |
| `tests/test_responses_router.py` | Router integration tests (mocked upstream) |

---

## Task 1: Project Initialization

**Files:**
- Create: `pyproject.toml`
- Create: `config.example.yaml`
- Create: `src/deepseek2responses/__init__.py`

- [ ] **Step 1: Initialize UV project**

Run: `cd /Users/lhy/Project/Tool/deepseek2responses && uv init --name deepseek2responses --description "Convert DeepSeek/Anthropic API to OpenAI Responses API"`
Expected: Creates `pyproject.toml`, `.python-version`, `README.md`

- [ ] **Step 2: Add dependencies**

Run: `uv add fastapi uvicorn httpx pyyaml`
Expected: Dependencies added to `pyproject.toml`

Run: `uv add --dev pytest pytest-asyncio`
Expected: Dev dependencies added

- [ ] **Step 3: Write pyproject.toml**

```toml
[project]
name = "deepseek2responses"
version = "0.1.0"
description = "Convert DeepSeek/Anthropic API to OpenAI Responses API"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn>=0.34.0",
    "httpx>=0.28.0",
    "pyyaml>=6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.25.0",
]

[project.scripts]
deepseek2responses = "deepseek2responses.main:main"
```

- [ ] **Step 4: Write config.example.yaml**

```yaml
server:
  host: "0.0.0.0"
  port: 8080

providers:
  deepseek:
    api_key: "sk-your-deepseek-key"
    base_url: "https://api.deepseek.com"
    model_mapping:
      "gpt-4.1": "deepseek-chat"
      "gpt-4.1-mini": "deepseek-chat"
      "o3-mini": "deepseek-reasoner"

  anthropic:
    api_key: "sk-ant-your-anthropic-key"
    base_url: "https://api.anthropic.com"
    model_mapping:
      "gpt-4.1": "claude-sonnet-4-20250514"
      "gpt-4.1-mini": "claude-3-5-haiku-20241022"

default_provider: "deepseek"
```

- [ ] **Step 5: Write __init__.py**

```python
__version__ = "0.1.0"
```

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml config.example.yaml src/deepseek2responses/__init__.py
git commit -m "feat: initialize project with dependencies and config"
```

---

## Task 2: Config Module

**Files:**
- Create: `src/deepseek2responses/config.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_config.py`:

```python
import pytest
from pathlib import Path
from deepseek2responses.config import load_config, Config, ServerConfig, ProviderConfig


class TestConfig:
    def test_load_config(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("""
server:
  host: "127.0.0.1"
  port: 9090
providers:
  deepseek:
    api_key: "sk-test"
    base_url: "https://api.deepseek.com"
    model_mapping:
      "gpt-4.1": "deepseek-chat"
default_provider: "deepseek"
""")
        config = load_config(str(config_path))
        assert config.server.host == "127.0.0.1"
        assert config.server.port == 9090
        assert config.providers["deepseek"].api_key == "sk-test"
        assert config.providers["deepseek"].model_mapping["gpt-4.1"] == "deepseek-chat"
        assert config.default_provider == "deepseek"

    def test_load_config_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            load_config("/nonexistent/config.yaml")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_config.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deepseek2responses.config'"

- [ ] **Step 3: Write minimal implementation**

Create `src/deepseek2responses/config.py`:

```python
from __future__ import annotations

import os
from pathlib import Path
from typing import Dict

import yaml
from pydantic import BaseModel


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8080


class ProviderConfig(BaseModel):
    api_key: str
    base_url: str
    model_mapping: Dict[str, str] = {}


class Config(BaseModel):
    server: ServerConfig = ServerConfig()
    providers: Dict[str, ProviderConfig]
    default_provider: str


def load_config(path: str | None = None) -> Config:
    if path is None:
        path = os.environ.get("DEEPSEEK2RESPONSES_CONFIG", "config.yaml")

    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    return Config(**data)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_config.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_config.py src/deepseek2responses/config.py
git commit -m "feat: add config loading module"
```

---

## Task 3: Pydantic Models

**Files:**
- Create: `src/deepseek2responses/models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_models.py`:

```python
import pytest
from deepseek2responses.models import (
    ResponseRequest,
    Response,
    OutputMessage,
    OutputText,
    Usage,
)


class TestModels:
    def test_response_request_basic(self):
        req = ResponseRequest(model="gpt-4.1", input="Hello")
        assert req.model == "gpt-4.1"
        assert req.input == "Hello"
        assert req.stream is False

    def test_response_request_with_messages(self):
        req = ResponseRequest(
            model="gpt-4.1",
            input=[{"role": "user", "content": "Hello"}],
        )
        assert isinstance(req.input, list)

    def test_response_basic(self):
        resp = Response(
            id="resp_test",
            model="gpt-4.1",
            output=[
                OutputMessage(
                    role="assistant",
                    content=[OutputText(text="Hi there")],
                )
            ],
            usage=Usage(input_tokens=10, output_tokens=5),
        )
        assert resp.status == "completed"
        assert resp.usage.total_tokens == 15
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_models.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'deepseek2responses.models'"

- [ ] **Step 3: Write minimal implementation**

Create `src/deepseek2responses/models.py`:

```python
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field


# Request models

class InputText(BaseModel):
    type: Literal["input_text"] = "input_text"
    text: str


class InputImage(BaseModel):
    type: Literal["input_image"] = "input_image"
    image_url: Optional[str] = None
    data: Optional[str] = None


InputContent = Union[InputText, InputImage]


class InputMessage(BaseModel):
    role: Literal["user", "assistant", "system", "developer"]
    content: Union[str, List[InputContent]]


class ToolFunction(BaseModel):
    name: str
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None


class Tool(BaseModel):
    type: Literal["function"] = "function"
    function: ToolFunction


class ResponseRequest(BaseModel):
    model: str
    input: Union[str, List[InputMessage]]
    instructions: Optional[str] = None
    temperature: Optional[float] = Field(default=1.0, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)
    max_output_tokens: Optional[int] = None
    stream: Optional[bool] = False
    tools: Optional[List[Tool]] = None
    tool_choice: Optional[Union[str, Dict[str, Any]]] = "auto"
    previous_response_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


# Response models

class OutputText(BaseModel):
    type: Literal["output_text"] = "output_text"
    text: str
    annotations: List[Any] = []


class FunctionCall(BaseModel):
    type: Literal["function_call"] = "function_call"
    id: str
    call_id: str
    name: str
    arguments: str


class OutputMessage(BaseModel):
    type: Literal["message"] = "message"
    id: Optional[str] = None
    status: Literal["in_progress", "completed", "incomplete"] = "completed"
    role: Literal["assistant"] = "assistant"
    content: List[Union[OutputText, FunctionCall]]


class Usage(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int


class Response(BaseModel):
    id: str
    object: Literal["response"] = "response"
    created_at: int = Field(default_factory=lambda: int(__import__("time").time()))
    status: Literal["in_progress", "completed", "incomplete"] = "completed"
    error: Optional[Dict[str, Any]] = None
    model: str
    output: List[Union[OutputMessage, FunctionCall]]
    usage: Optional[Usage] = None
    metadata: Optional[Dict[str, Any]] = None


# Error model

class ErrorResponse(BaseModel):
    error: Dict[str, Any]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_models.py src/deepseek2responses/models.py
git commit -m "feat: add pydantic models for responses api"
```

---

## Task 4: Converter Base Class

**Files:**
- Create: `src/deepseek2responses/converters/__init__.py`
- Create: `src/deepseek2responses/converters/base.py`
- Test: `tests/test_base_converter.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_base_converter.py`:

```python
import pytest
from deepseek2responses.converters.base import BaseConverter
from deepseek2responses.models import ResponseRequest


class TestBaseConverter:
    def test_generate_id(self):
        class DummyConverter(BaseConverter):
            async def convert_request(self, request):
                pass

            async def convert_response(self, response_data, model):
                pass

            async def convert_stream(self, response_stream, model):
                pass

        conv = DummyConverter("test", "sk-test", "https://api.test.com", {})
        resp_id = conv.generate_id("resp_")
        assert resp_id.startswith("resp_")
        assert len(resp_id) == 29  # "resp_" + 24 hex chars

    def test_map_model(self):
        class DummyConverter(BaseConverter):
            async def convert_request(self, request):
                pass

            async def convert_response(self, response_data, model):
                pass

            async def convert_stream(self, response_stream, model):
                pass

        conv = DummyConverter("test", "sk-test", "https://api.test.com", {"gpt-4": "model-x"})
        assert conv.map_model("gpt-4") == "model-x"
        assert conv.map_model("unknown") == "unknown"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_base_converter.py -v`
Expected: FAIL with "ModuleNotFoundError"

- [ ] **Step 3: Write minimal implementation**

Create `src/deepseek2responses/converters/__init__.py`:
```python
from deepseek2responses.converters.base import BaseConverter
from deepseek2responses.converters.deepseek import DeepSeekConverter
from deepseek2responses.converters.anthropic import AnthropicConverter

__all__ = ["BaseConverter", "DeepSeekConverter", "AnthropicConverter"]
```

Create `src/deepseek2responses/converters/base.py`:

```python
from __future__ import annotations

import secrets
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict

from deepseek2responses.models import Response, ResponseRequest


class BaseConverter(ABC):
    def __init__(self, name: str, api_key: str, base_url: str, model_mapping: Dict[str, str]):
        self.name = name
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model_mapping = model_mapping

    def generate_id(self, prefix: str) -> str:
        return f"{prefix}{secrets.token_hex(24)}"

    def map_model(self, model: str) -> str:
        return self.model_mapping.get(model, model)

    @abstractmethod
    async def convert_request(self, request: ResponseRequest) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def convert_response(self, response_data: Dict[str, Any], model: str) -> Response:
        pass

    @abstractmethod
    async def convert_stream(self, response_stream: AsyncIterator[str], model: str) -> AsyncIterator[str]:
        pass
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_base_converter.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_base_converter.py src/deepseek2responses/converters/
git commit -m "feat: add converter base class"
```

---

## Task 5: DeepSeek Converter

**Files:**
- Create: `src/deepseek2responses/converters/deepseek.py`
- Test: `tests/test_deepseek_converter.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_deepseek_converter.py`:

```python
import pytest
from deepseek2responses.converters.deepseek import DeepSeekConverter
from deepseek2responses.models import ResponseRequest, InputMessage, InputText


class TestDeepSeekConverter:
    @pytest.fixture
    def converter(self):
        return DeepSeekConverter("deepseek", "sk-test", "https://api.deepseek.com", {"gpt-4.1": "deepseek-chat"})

    @pytest.mark.asyncio
    async def test_convert_request_string_input(self, converter):
        req = ResponseRequest(model="gpt-4.1", input="Hello")
        result = await converter.convert_request(req)
        assert result["model"] == "deepseek-chat"
        assert result["messages"] == [{"role": "user", "content": "Hello"}]
        assert result["stream"] is False

    @pytest.mark.asyncio
    async def test_convert_request_with_instructions(self, converter):
        req = ResponseRequest(model="gpt-4.1", input="Hello", instructions="Be helpful")
        result = await converter.convert_request(req)
        assert result["messages"][0]["role"] == "system"
        assert result["messages"][0]["content"] == "Be helpful"
        assert result["messages"][1]["role"] == "user"

    @pytest.mark.asyncio
    async def test_convert_response(self, converter):
        upstream = {
            "choices": [{"message": {"role": "assistant", "content": "Hi there"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        resp = await converter.convert_response(upstream, "gpt-4.1")
        assert resp.status == "completed"
        assert resp.model == "gpt-4.1"
        assert resp.output[0].content[0].text == "Hi there"
        assert resp.usage.total_tokens == 15
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_deepseek_converter.py -v`
Expected: FAIL with "ModuleNotFoundError"

- [ ] **Step 3: Write minimal implementation**

Create `src/deepseek2responses/converters/deepseek.py`:

```python
from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator, Dict, List

from deepseek2responses.converters.base import BaseConverter
from deepseek2responses.models import (
    FunctionCall,
    OutputMessage,
    OutputText,
    Response,
    ResponseRequest,
    Usage,
)


class DeepSeekConverter(BaseConverter):
    async def convert_request(self, request: ResponseRequest) -> Dict[str, Any]:
        messages: List[Dict[str, Any]] = []

        if request.instructions:
            messages.append({"role": "system", "content": request.instructions})

        if isinstance(request.input, str):
            messages.append({"role": "user", "content": request.input})
        else:
            for msg in request.input:
                if isinstance(msg.content, str):
                    messages.append({"role": msg.role, "content": msg.content})
                else:
                    content_parts = []
                    for part in msg.content:
                        if part.type == "input_text":
                            content_parts.append({"type": "text", "text": part.text})
                        elif part.type == "input_image":
                            if part.image_url:
                                content_parts.append({"type": "image_url", "image_url": {"url": part.image_url}})
                            elif part.data:
                                content_parts.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{part.data}"}})
                    messages.append({"role": msg.role, "content": content_parts})

        payload: Dict[str, Any] = {
            "model": self.map_model(request.model),
            "messages": messages,
            "stream": request.stream or False,
        }

        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.top_p is not None:
            payload["top_p"] = request.top_p
        if request.max_output_tokens is not None:
            payload["max_tokens"] = request.max_output_tokens

        if request.tools:
            tools = []
            for tool in request.tools:
                if tool.type == "function":
                    tools.append({
                        "type": "function",
                        "function": {
                            "name": tool.function.name,
                            "description": tool.function.description,
                            "parameters": tool.function.parameters,
                        },
                    })
            if tools:
                payload["tools"] = tools
                payload["tool_choice"] = request.tool_choice

        return payload

    async def convert_response(self, response_data: Dict[str, Any], model: str) -> Response:
        choice = response_data.get("choices", [{}])[0]
        message = choice.get("message", {})
        content = message.get("content", "")
        tool_calls = message.get("tool_calls", [])

        output_items = []
        if tool_calls:
            for tc in tool_calls:
                output_items.append(FunctionCall(
                    id=self.generate_id("fc_"),
                    call_id=tc.get("id", self.generate_id("call_")),
                    name=tc.get("function", {}).get("name", ""),
                    arguments=tc.get("function", {}).get("arguments", ""),
                ))
        else:
            output_items.append(OutputMessage(
                id=self.generate_id("msg_"),
                content=[OutputText(text=content or "")],
            ))

        usage_data = response_data.get("usage", {})
        usage = Usage(
            input_tokens=usage_data.get("prompt_tokens", 0),
            output_tokens=usage_data.get("completion_tokens", 0),
            total_tokens=usage_data.get("total_tokens", 0),
        )

        return Response(
            id=self.generate_id("resp_"),
            model=model,
            output=output_items,
            usage=usage,
        )

    async def convert_stream(self, response_stream: AsyncIterator[str], model: str) -> AsyncIterator[str]:
        resp_id = self.generate_id("resp_")
        msg_id = self.generate_id("msg_")
        created_at = int(time.time())

        # Emit response.created
        yield f"event: response.created\ndata: {json.dumps({'type': 'response.created', 'response': {'id': resp_id, 'object': 'response', 'created_at': created_at, 'status': 'in_progress', 'model': model, 'output': []}})}\n\n"

        # Emit response.in_progress
        yield f"event: response.in_progress\ndata: {json.dumps({'type': 'response.in_progress', 'response': {'id': resp_id, 'object': 'response', 'created_at': created_at, 'status': 'in_progress', 'model': model, 'output': []}})}\n\n"

        # Emit output_item.added and content_part.added
        yield f"event: response.output_item.added\ndata: {json.dumps({'type': 'response.output_item.added', 'output_index': 0, 'item': {'id': msg_id, 'type': 'message', 'status': 'in_progress', 'role': 'assistant', 'content': []}})}\n\n"
        yield f"event: response.content_part.added\ndata: {json.dumps({'type': 'response.content_part.added', 'item_id': msg_id, 'output_index': 0, 'content_index': 0, 'part': {'type': 'output_text', 'text': '', 'annotations': []}})}\n\n"

        buffer = ""
        async for line in response_stream:
            line = line.strip()
            if line == "data: [DONE]" or line == "[DONE]":
                break
            if line.startswith("data: "):
                data = line[6:]
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    buffer += content
                    yield f"event: response.output_text.delta\ndata: {json.dumps({'type': 'response.output_text.delta', 'item_id': msg_id, 'output_index': 0, 'content_index': 0, 'delta': content})}\n\n"

        # Emit done events
        yield f"event: response.output_text.done\ndata: {json.dumps({'type': 'response.output_text.done', 'item_id': msg_id, 'output_index': 0, 'content_index': 0, 'text': buffer})}\n\n"
        yield f"event: response.content_part.done\ndata: {json.dumps({'type': 'response.content_part.done', 'item_id': msg_id, 'output_index': 0, 'content_index': 0, 'part': {'type': 'output_text', 'text': buffer, 'annotations': []}})}\n\n"
        yield f"event: response.output_item.done\ndata: {json.dumps({'type': 'response.output_item.done', 'output_index': 0, 'item': {'id': msg_id, 'type': 'message', 'status': 'completed', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': buffer, 'annotations': []}]}})}\n\n"
        yield f"event: response.completed\ndata: {json.dumps({'type': 'response.completed', 'response': {'id': resp_id, 'object': 'response', 'created_at': created_at, 'status': 'completed', 'model': model, 'output': [{'type': 'message', 'id': msg_id, 'status': 'completed', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': buffer, 'annotations': []}]}]}})}\n\n"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_deepseek_converter.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_deepseek_converter.py src/deepseek2responses/converters/deepseek.py
git commit -m "feat: add deepseek converter with request/response/stream conversion"
```

---

## Task 6: Anthropic Converter

**Files:**
- Create: `src/deepseek2responses/converters/anthropic.py`
- Test: `tests/test_anthropic_converter.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_anthropic_converter.py`:

```python
import pytest
from deepseek2responses.converters.anthropic import AnthropicConverter
from deepseek2responses.models import ResponseRequest


class TestAnthropicConverter:
    @pytest.fixture
    def converter(self):
        return AnthropicConverter("anthropic", "sk-ant-test", "https://api.anthropic.com", {"gpt-4.1": "claude-sonnet-4-20250514"})

    @pytest.mark.asyncio
    async def test_convert_request_string_input(self, converter):
        req = ResponseRequest(model="gpt-4.1", input="Hello")
        result = await converter.convert_request(req)
        assert result["model"] == "claude-sonnet-4-20250514"
        assert result["messages"] == [{"role": "user", "content": "Hello"}]
        assert result["max_tokens"] == 4096
        assert result["stream"] is False

    @pytest.mark.asyncio
    async def test_convert_request_with_instructions(self, converter):
        req = ResponseRequest(model="gpt-4.1", input="Hello", instructions="Be helpful")
        result = await converter.convert_request(req)
        assert result["system"] == "Be helpful"
        assert result["messages"][0]["role"] == "user"

    @pytest.mark.asyncio
    async def test_convert_response(self, converter):
        upstream = {
            "content": [{"type": "text", "text": "Hi there"}],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        resp = await converter.convert_response(upstream, "gpt-4.1")
        assert resp.status == "completed"
        assert resp.model == "gpt-4.1"
        assert resp.output[0].content[0].text == "Hi there"
        assert resp.usage.total_tokens == 15
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_anthropic_converter.py -v`
Expected: FAIL with "ModuleNotFoundError"

- [ ] **Step 3: Write minimal implementation**

Create `src/deepseek2responses/converters/anthropic.py`:

```python
from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator, Dict, List

from deepseek2responses.converters.base import BaseConverter
from deepseek2responses.models import (
    FunctionCall,
    OutputMessage,
    OutputText,
    Response,
    ResponseRequest,
    Usage,
)


class AnthropicConverter(BaseConverter):
    async def convert_request(self, request: ResponseRequest) -> Dict[str, Any]:
        messages: List[Dict[str, Any]] = []

        if isinstance(request.input, str):
            messages.append({"role": "user", "content": request.input})
        else:
            for msg in request.input:
                if isinstance(msg.content, str):
                    messages.append({"role": msg.role, "content": msg.content})
                else:
                    content_parts = []
                    for part in msg.content:
                        if part.type == "input_text":
                            content_parts.append({"type": "text", "text": part.text})
                        elif part.type == "input_image":
                            if part.image_url:
                                content_parts.append({"type": "image", "source": {"type": "url", "url": part.image_url}})
                            elif part.data:
                                content_parts.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": part.data}})
                    messages.append({"role": msg.role, "content": content_parts})

        payload: Dict[str, Any] = {
            "model": self.map_model(request.model),
            "messages": messages,
            "max_tokens": request.max_output_tokens or 4096,
            "stream": request.stream or False,
        }

        if request.instructions:
            payload["system"] = request.instructions
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.top_p is not None:
            payload["top_p"] = request.top_p

        if request.tools:
            tools = []
            for tool in request.tools:
                if tool.type == "function":
                    tools.append({
                        "name": tool.function.name,
                        "description": tool.function.description,
                        "input_schema": tool.function.parameters or {"type": "object", "properties": {}},
                    })
            if tools:
                payload["tools"] = tools
                if request.tool_choice and request.tool_choice != "auto":
                    payload["tool_choice"] = {"type": "tool", "name": request.tool_choice}
                else:
                    payload["tool_choice"] = {"type": "auto"}

        return payload

    async def convert_response(self, response_data: Dict[str, Any], model: str) -> Response:
        content_blocks = response_data.get("content", [])
        output_items = []

        for block in content_blocks:
            if block.get("type") == "text":
                output_items.append(OutputMessage(
                    id=self.generate_id("msg_"),
                    content=[OutputText(text=block.get("text", ""))],
                ))
            elif block.get("type") == "tool_use":
                output_items.append(FunctionCall(
                    id=self.generate_id("fc_"),
                    call_id=block.get("id", self.generate_id("call_")),
                    name=block.get("name", ""),
                    arguments=json.dumps(block.get("input", {})),
                ))

        if not output_items:
            output_items.append(OutputMessage(
                id=self.generate_id("msg_"),
                content=[OutputText(text="")],
            ))

        usage_data = response_data.get("usage", {})
        usage = Usage(
            input_tokens=usage_data.get("input_tokens", 0),
            output_tokens=usage_data.get("output_tokens", 0),
            total_tokens=usage_data.get("input_tokens", 0) + usage_data.get("output_tokens", 0),
        )

        return Response(
            id=self.generate_id("resp_"),
            model=model,
            output=output_items,
            usage=usage,
        )

    async def convert_stream(self, response_stream: AsyncIterator[str], model: str) -> AsyncIterator[str]:
        resp_id = self.generate_id("resp_")
        msg_id = self.generate_id("msg_")
        created_at = int(time.time())

        yield f"event: response.created\ndata: {json.dumps({'type': 'response.created', 'response': {'id': resp_id, 'object': 'response', 'created_at': created_at, 'status': 'in_progress', 'model': model, 'output': []}})}\n\n"
        yield f"event: response.in_progress\ndata: {json.dumps({'type': 'response.in_progress', 'response': {'id': resp_id, 'object': 'response', 'created_at': created_at, 'status': 'in_progress', 'model': model, 'output': []}})}\n\n"
        yield f"event: response.output_item.added\ndata: {json.dumps({'type': 'response.output_item.added', 'output_index': 0, 'item': {'id': msg_id, 'type': 'message', 'status': 'in_progress', 'role': 'assistant', 'content': []}})}\n\n"
        yield f"event: response.content_part.added\ndata: {json.dumps({'type': 'response.content_part.added', 'item_id': msg_id, 'output_index': 0, 'content_index': 0, 'part': {'type': 'output_text', 'text': '', 'annotations': []}})}\n\n"

        buffer = ""
        async for line in response_stream:
            line = line.strip()
            if not line.startswith("data: "):
                continue
            data = line[6:]
            try:
                event = json.loads(data)
            except json.JSONDecodeError:
                continue

            event_type = event.get("type", "")
            if event_type == "content_block_delta":
                delta = event.get("delta", {})
                if delta.get("type") == "text_delta":
                    text = delta.get("text", "")
                    buffer += text
                    yield f"event: response.output_text.delta\ndata: {json.dumps({'type': 'response.output_text.delta', 'item_id': msg_id, 'output_index': 0, 'content_index': 0, 'delta': text})}\n\n"

        yield f"event: response.output_text.done\ndata: {json.dumps({'type': 'response.output_text.done', 'item_id': msg_id, 'output_index': 0, 'content_index': 0, 'text': buffer})}\n\n"
        yield f"event: response.content_part.done\ndata: {json.dumps({'type': 'response.content_part.done', 'item_id': msg_id, 'output_index': 0, 'content_index': 0, 'part': {'type': 'output_text', 'text': buffer, 'annotations': []}})}\n\n"
        yield f"event: response.output_item.done\ndata: {json.dumps({'type': 'response.output_item.done', 'output_index': 0, 'item': {'id': msg_id, 'type': 'message', 'status': 'completed', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': buffer, 'annotations': []}]}})}\n\n"
        yield f"event: response.completed\ndata: {json.dumps({'type': 'response.completed', 'response': {'id': resp_id, 'object': 'response', 'created_at': created_at, 'status': 'completed', 'model': model, 'output': [{'type': 'message', 'id': msg_id, 'status': 'completed', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': buffer, 'annotations': []}]}]}})}\n\n"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_anthropic_converter.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_anthropic_converter.py src/deepseek2responses/converters/anthropic.py
git commit -m "feat: add anthropic converter with request/response/stream conversion"
```

---

## Task 7: Responses Router

**Files:**
- Create: `src/deepseek2responses/routers/__init__.py`
- Create: `src/deepseek2responses/routers/responses.py`
- Test: `tests/test_responses_router.py`

- [ ] **Step 1: Write failing test**

Create `tests/test_responses_router.py`:

```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from deepseek2responses.main import create_app
from deepseek2responses.config import Config, ServerConfig, ProviderConfig


class TestResponsesRouter:
    @pytest.fixture
    def client(self):
        config = Config(
            server=ServerConfig(),
            providers={
                "deepseek": ProviderConfig(
                    api_key="sk-test",
                    base_url="https://api.deepseek.com",
                    model_mapping={"gpt-4.1": "deepseek-chat"},
                )
            },
            default_provider="deepseek",
        )
        app = create_app(config)
        return TestClient(app)

    def test_responses_non_streaming(self, client):
        mock_response = {
            "choices": [{"message": {"role": "assistant", "content": "Hello!"}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
        }
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value.status_code = 200
            mock_post.return_value.json = lambda: mock_response
            mock_post.return_value.aiter_lines = AsyncMock(return_value=[])
            mock_post.return_value.headers = {"content-type": "application/json"}

            response = client.post("/v1/responses", json={"model": "gpt-4.1", "input": "Hi"})
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "completed"
            assert data["model"] == "gpt-4.1"
            assert data["output"][0]["content"][0]["text"] == "Hello!"

    def test_responses_streaming(self, client):
        sse_lines = [
            'data: {"choices": [{"delta": {"content": "He"}}]}',
            'data: {"choices": [{"delta": {"content": "llo"}}]}',
            "data: [DONE]",
        ]
        async def mock_aiter_lines():
            for line in sse_lines:
                yield line

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value.status_code = 200
            mock_post.return_value.headers = {"content-type": "text/event-stream"}
            mock_post.return_value.aiter_lines = mock_aiter_lines

            response = client.post("/v1/responses", json={"model": "gpt-4.1", "input": "Hi", "stream": True})
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"]
            body = response.text
            assert "response.created" in body
            assert "response.output_text.delta" in body
            assert "response.completed" in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_responses_router.py -v`
Expected: FAIL with "ModuleNotFoundError" or import errors

- [ ] **Step 3: Write minimal implementation**

Create `src/deepseek2responses/routers/__init__.py`:
```python
from deepseek2responses.routers.responses import router

__all__ = ["router"]
```

Create `src/deepseek2responses/routers/responses.py`:

```python
from __future__ import annotations

import json
from typing import Any, Dict

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from deepseek2responses.config import Config
from deepseek2responses.converters.base import BaseConverter
from deepseek2responses.converters.deepseek import DeepSeekConverter
from deepseek2responses.converters.anthropic import AnthropicConverter
from deepseek2responses.models import ErrorResponse, ResponseRequest

router = APIRouter()


def get_converter(config: Config, provider_name: str | None) -> BaseConverter:
    name = provider_name or config.default_provider
    if name not in config.providers:
        raise HTTPException(status_code=404, detail=f"Provider '{name}' not found")

    provider = config.providers[name]
    if name == "deepseek":
        return DeepSeekConverter(name, provider.api_key, provider.base_url, provider.model_mapping)
    elif name == "anthropic":
        return AnthropicConverter(name, provider.api_key, provider.base_url, provider.model_mapping)
    else:
        raise HTTPException(status_code=404, detail=f"Provider '{name}' not supported")


@router.post("/v1/responses")
async def create_response(
    request: Request,
    body: ResponseRequest,
    x_provider: str | None = Header(None, alias="X-Provider"),
):
    config: Config = request.app.state.config
    converter = get_converter(config, x_provider)

    upstream_request = await converter.convert_request(body)
    upstream_url = f"{converter.base_url}/v1/chat/completions"
    if converter.name == "anthropic":
        upstream_url = f"{converter.base_url}/v1/messages"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {converter.api_key}",
    }
    if converter.name == "anthropic":
        headers["x-api-key"] = converter.api_key
        headers["anthropic-version"] = "2023-06-01"
        del headers["Authorization"]

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            if body.stream:
                upstream_response = await client.post(
                    upstream_url,
                    json=upstream_request,
                    headers=headers,
                    timeout=120.0,
                )
                upstream_response.raise_for_status()

                async def stream_generator():
                    async for line in upstream_response.aiter_lines():
                        yield line + "\n"

                return StreamingResponse(
                    converter.convert_stream(stream_generator(), body.model),
                    media_type="text/event-stream",
                )
            else:
                upstream_response = await client.post(
                    upstream_url,
                    json=upstream_request,
                    headers=headers,
                    timeout=120.0,
                )
                upstream_response.raise_for_status()
                response_data = upstream_response.json()
                result = await converter.convert_response(response_data, body.model)
                return JSONResponse(content=result.model_dump(mode="json"))

        except httpx.HTTPStatusError as e:
            error_body = {}
            try:
                error_body = e.response.json()
            except Exception:
                error_body = {"message": str(e)}
            return JSONResponse(
                status_code=e.response.status_code,
                content=ErrorResponse(
                    error={"code": "provider_error", "message": json.dumps(error_body)}
                ).model_dump(mode="json"),
            )
        except httpx.TimeoutException:
            return JSONResponse(
                status_code=504,
                content=ErrorResponse(
                    error={"code": "gateway_timeout", "message": "Upstream API timeout"}
                ).model_dump(mode="json"),
            )
        except httpx.ConnectError:
            return JSONResponse(
                status_code=502,
                content=ErrorResponse(
                    error={"code": "bad_gateway", "message": "Upstream API unreachable"}
                ).model_dump(mode="json"),
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_responses_router.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_responses_router.py src/deepseek2responses/routers/
git commit -m "feat: add responses router with upstream proxy logic"
```

---

## Task 8: Main Entrypoint

**Files:**
- Create: `src/deepseek2responses/main.py`
- Modify: `pyproject.toml` (add script entrypoint)

- [ ] **Step 1: Write failing test**

Create `tests/test_main.py`:

```python
import pytest
from deepseek2responses.main import create_app
from deepseek2responses.config import Config, ServerConfig, ProviderConfig


class TestMain:
    def test_create_app(self):
        config = Config(
            server=ServerConfig(),
            providers={
                "deepseek": ProviderConfig(
                    api_key="sk-test",
                    base_url="https://api.deepseek.com",
                    model_mapping={},
                )
            },
            default_provider="deepseek",
        )
        app = create_app(config)
        assert app is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_main.py -v`
Expected: FAIL with "ModuleNotFoundError"

- [ ] **Step 3: Write minimal implementation**

Create `src/deepseek2responses/main.py`:

```python
from __future__ import annotations

import argparse
import sys

import uvicorn
from fastapi import FastAPI

from deepseek2responses.config import Config, load_config
from deepseek2responses.routers.responses import router


def create_app(config: Config) -> FastAPI:
    app = FastAPI(
        title="deepseek2responses",
        description="Convert DeepSeek/Anthropic API to OpenAI Responses API",
        version="0.1.0",
    )
    app.state.config = config
    app.include_router(router)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="deepseek2responses proxy server")
    parser.add_argument("--config", "-c", type=str, default=None, help="Path to config file")
    parser.add_argument("--port", "-p", type=int, default=None, help="Server port (overrides config)")
    parser.add_argument("--version", "-v", action="store_true", help="Show version")
    args = parser.parse_args()

    if args.version:
        from deepseek2responses import __version__
        print(f"deepseek2responses v{__version__}")
        sys.exit(0)

    config = load_config(args.config)
    app = create_app(config)

    host = config.server.host
    port = args.port or config.server.port

    print(f"deepseek2responses v0.1.0")
    print(f"Config loaded")
    print(f"Provider: {config.default_provider} (default)")
    print(f"Listening on http://{host}:{port}")
    print(f"API docs: http://{host}:{port}/docs")

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Update pyproject.toml**

Add to `pyproject.toml`:
```toml
[project.scripts]
deepseek2responses = "deepseek2responses.main:main"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_main.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/test_main.py src/deepseek2responses/main.py pyproject.toml
git commit -m "feat: add main entrypoint with CLI and uvicorn server"
```

---

## Task 9: Final Integration & Verification

**Files:**
- All files

- [ ] **Step 1: Run all tests**

Run: `uv run pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 2: Verify CLI help**

Run: `uv run python -m deepseek2responses.main --help`
Expected: Shows help text with --config, --port, --version options

- [ ] **Step 3: Verify version**

Run: `uv run python -m deepseek2responses.main --version`
Expected: `deepseek2responses v0.1.0`

- [ ] **Step 4: Verify imports**

Run: `uv run python -c "from deepseek2responses import __version__; print(__version__)"`
Expected: `0.1.0`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete deepseek2responses v0.1.0"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| FastAPI + httpx architecture | Task 7, 8 |
| Config loading from YAML | Task 2 |
| Pydantic request/response models | Task 3 |
| Converter base class | Task 4 |
| DeepSeek converter (req/res/stream) | Task 5 |
| Anthropic converter (req/res/stream) | Task 6 |
| `/v1/responses` route | Task 7 |
| Non-streaming response | Task 5, 6, 7 |
| Streaming response (SSE) | Task 5, 6, 7 |
| Error handling (timeout, unreachable, upstream errors) | Task 7 |
| Model mapping | Task 2, 4, 5, 6 |
| Function calling support | Task 5, 6 |
| CLI entrypoint | Task 8 |
| Tests for all components | All tasks |

No gaps found. All spec requirements covered.

## Placeholder Scan

- No "TBD", "TODO", "implement later" found
- No vague "add error handling" without code
- No "write tests for the above" without test code
- All steps contain actual code/commands

Clean.

## Type Consistency Check

- `BaseConverter.generate_id(prefix: str) -> str` used consistently
- `BaseConverter.map_model(model: str) -> str` used consistently
- `ResponseRequest` model fields match across all converters
- `Response` model fields consistent in all convert_response methods
- Stream generator signature consistent across converters

Consistent.
