from __future__ import annotations

import json
import secrets
import time
from collections import OrderedDict
from typing import Any, AsyncIterator

from deepseek2responses.models import (
    FunctionCall,
    FunctionCallOutput,
    InputFile,
    InputImage,
    InputMessage,
    InputText,
    OutputMessage,
    OutputText,
    OutputThinking,
    ReasoningItem,
    ReasoningSummaryPart,
    Response,
    ResponseRequest,
    Usage,
)


def _flatten_input(content: str | list) -> str | list[dict[str, Any]]:
    if isinstance(content, str):
        return content
    parts: list[dict[str, Any]] = []
    for p in content:
        if isinstance(p, dict):
            t = p.get("type", "")
            if t == "input_text":
                parts.append({"type": "text", "text": p.get("text", "")})
            elif t == "input_image":
                img = {"type": "image_url", "image_url": {"url": p.get("image_url", "")}}
                if p.get("detail"):
                    img["image_url"]["detail"] = p["detail"]
                parts.append(img)
            elif t == "output_text":
                parts.append({"type": "text", "text": p.get("text", "")})
            elif t == "function_call":
                try:
                    args = json.loads(p.get("arguments", "{}")) if isinstance(p.get("arguments"), str) else p.get("arguments", {})
                except (json.JSONDecodeError, TypeError):
                    args = {}
                parts.append({"type": "tool_use", "id": p.get("call_id", ""), "name": p.get("name", ""), "input": args})
            elif t == "function_call_output":
                output = p.get("output", "")
                if isinstance(output, list):
                    output = "".join(
                        i.get("text", "") if isinstance(i, dict) and i.get("type") in ("input_text", "output_text") else ""
                        for i in output
                    )
                parts.append({"type": "tool_result", "tool_use_id": p.get("call_id", ""), "content": str(output)})
            elif t == "input_file":
                pass
        elif hasattr(p, "type"):
            if p.type == "input_text":
                parts.append({"type": "text", "text": p.text})
            elif p.type == "input_image":
                img = {"type": "image_url", "image_url": {"url": p.image_url or ""}}
                if p.detail:
                    img["image_url"]["detail"] = p.detail
                parts.append(img)
            elif p.type == "output_text":
                parts.append({"type": "text", "text": p.text})
            elif p.type == "function_call":
                try:
                    args = json.loads(p.arguments) if isinstance(p.arguments, str) else p.arguments
                except (json.JSONDecodeError, TypeError):
                    args = {}
                parts.append({"type": "tool_use", "id": p.call_id, "name": p.name, "input": args})
            elif p.type == "function_call_output":
                output = p.output
                if isinstance(output, list):
                    output = "".join(
                        i.text if hasattr(i, "text") and i.type in ("input_text", "output_text") else ""
                        for i in output
                    )
                parts.append({"type": "tool_result", "tool_use_id": p.call_id, "content": str(output)})
            elif p.type == "input_file":
                pass
    if parts and all(pp.get("type") == "text" for pp in parts):
        return "".join(pp["text"] for pp in parts)
    if not parts:
        return ""
    return parts


_LOCAL_SHELL_FN = {
    "type": "function",
    "function": {
        "name": "shell",
        "description": "Execute a shell command on the local machine. Returns stdout, stderr and exit code.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "array", "items": {"type": "string"}, "description": "Argv array, e.g. [\"ls\", \"-la\"]."},
                "workdir": {"type": "string", "description": "Working directory (optional)."},
                "timeout_ms": {"type": "number", "description": "Timeout in milliseconds (optional, default 30000)."},
            },
            "required": ["command"],
        },
    },
}

_SERVER_SIDE_TOOLS = {"code_interpreter", "file_search", "image_generation", "computer_use_preview", "computer_use"}


def _translate_tool(t: Any) -> list[dict[str, Any]]:
    is_dict = isinstance(t, dict)
    ttype = t.get("type", None) if is_dict else getattr(t, "type", None)

    if ttype == "function":
        if is_dict:
            raw = t
            # OpenAI Responses API function tool format — fields at top level
            name = raw.get("name", "")
            if not name:
                return []
            fn_def: dict[str, Any] = {"name": name}
            if raw.get("description"):
                fn_def["description"] = raw["description"]
            if raw.get("parameters"):
                fn_def["parameters"] = raw["parameters"]
            if isinstance(raw.get("strict"), bool):
                fn_def["strict"] = raw["strict"]
            return [{"type": "function", "function": fn_def}]
        else:
            name = getattr(t, "name", None)
            if not name:
                return []
            fn_def: dict[str, Any] = {"name": name}
            desc = getattr(t, "description", None)
            if desc:
                fn_def["description"] = desc
            params = getattr(t, "parameters", None)
            if params:
                fn_def["parameters"] = params
            strict = getattr(t, "strict", None)
            if isinstance(strict, bool):
                fn_def["strict"] = strict
            return [{"type": "function", "function": fn_def}]
    if ttype == "local_shell":
        return [_LOCAL_SHELL_FN]
    if ttype in ("web_search", "web_search_preview"):
        return []
    if ttype == "custom":
        name = getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else None)
        if not name:
            return []
        fmt = getattr(t, "format", None) or (t.get("format") if isinstance(t, dict) else None)
        fmt_type = (getattr(fmt, "type", None) or fmt.get("type")) if fmt else None
        desc = (getattr(t, "description", None) or (t.get("description") if isinstance(t, dict) else None) or "")
        if fmt_type:
            desc = f"{desc} (originally a \"{fmt_type}\"-format custom tool).".strip()
        return [{
            "type": "function",
            "function": {
                "name": name, "description": desc or None,
                "parameters": {"type": "object", "properties": {"input": {"type": "string", "description": "Input text."}}, "additionalProperties": True},
            },
        }]
    if ttype == "namespace":
        nested = getattr(t, "tools", None) or (t.get("tools") if isinstance(t, dict) else None)
        if not isinstance(nested, list) or not nested:
            return []
        result: list[dict[str, Any]] = []
        for inner in nested:
            result.extend(_translate_tool(inner))
        return result
    if ttype in _SERVER_SIDE_TOOLS:
        return []
    return []


class DeepSeekConverter:
    def __init__(self, api_key: str, base_url: str, model_mapping: dict[str, str]):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model_mapping = model_mapping
        self._response_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._cache_max = 256
        self._reasoning_store: dict[str, str] = {}

    @property
    def upstream_url(self) -> str:
        return f"{self.base_url}/chat/completions"

    @property
    def auth_headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def map_model(self, model: str) -> str:
        return self.model_mapping.get(model, model)

    def _generate_id(self, prefix: str) -> str:
        return f"{prefix}{secrets.token_hex(12)}"

    def _cache_put(self, resp_id: str, payload: dict[str, Any]) -> None:
        self._response_cache[resp_id] = payload
        while len(self._response_cache) > self._cache_max:
            self._response_cache.popitem(last=False)

    async def convert_request(self, request: ResponseRequest) -> dict[str, Any]:
        messages: list[dict[str, Any]] = []
        if request.instructions:
            messages.append({"role": "system", "content": request.instructions})

        pending: dict[str, Any] | None = None  # buffered assistant message

        def _flush_pending():
            nonlocal pending
            if pending is None:
                return
            if pending.get("content") is None and not pending.get("tool_calls"):
                pending["content"] = ""
            messages.append(pending)
            pending = None

        def _process_items(items):
            nonlocal pending
            for item in items:
                if isinstance(item, dict):
                    itype = item.get("type", "message")
                    if itype == "message" or (itype not in ("function_call", "function_call_output", "reasoning") and item.get("role")):
                        role = item.get("role", "user")
                        if role in ("system", "developer"):
                            content = _flatten_input(item.get("content", ""))
                            txt = content if isinstance(content, str) else "".join(
                                p.get("text", "") for p in content if p.get("type") == "text"
                            )
                            if txt:
                                messages.append({"role": "system", "content": txt})
                        elif role == "assistant":
                            if pending is not None:
                                _flush_pending()
                            content = _flatten_input(item.get("content", ""))
                            if isinstance(content, str):
                                pending = {"role": "assistant", "content": content}
                            else:
                                tc = [p for p in content if p.get("type") == "tool_use"]
                                txt_parts = [p for p in content if p.get("type") == "text"]
                                txt = "".join(p.get("text", "") for p in txt_parts)
                                msg: dict[str, Any] = {"role": "assistant", "content": txt if txt else None}
                                if tc:
                                    msg["tool_calls"] = [
                                        {"id": tcu["id"], "type": "function", "function": {"name": tcu["name"], "arguments": json.dumps(tcu.get("input", {}), ensure_ascii=False)}}
                                        for tcu in tc
                                    ]
                                pending = msg
                        elif role == "tool":
                            _flush_pending()
                            content = item.get("content", "")
                            if isinstance(content, list):
                                content = "".join(
                                    (p.get("text", "") if isinstance(p, dict) else getattr(p, "text", ""))
                                    for p in content
                                    if (isinstance(p, dict) and p.get("type") in ("input_text", "output_text")) or (hasattr(p, "type") and p.type in ("input_text", "output_text"))
                                )
                            messages.append({"role": "tool", "tool_call_id": item.get("tool_call_id", item.get("call_id", "")), "content": str(content)})
                        else:
                            _flush_pending()
                            content = _flatten_input(item.get("content", ""))
                            messages.append({"role": role, "content": content})
                    elif itype == "function_call":
                        if pending is not None and pending.get("role") == "assistant":
                            tc_list = pending.setdefault("tool_calls", [])
                            tc_list.append({
                                "id": item.get("call_id", ""),
                                "type": "function",
                                "function": {"name": item.get("name", ""), "arguments": item.get("arguments", "")},
                            })
                        else:
                            _flush_pending()
                            pending = {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [{
                                    "id": item.get("call_id", ""),
                                    "type": "function",
                                    "function": {"name": item.get("name", ""), "arguments": item.get("arguments", "")},
                                }],
                            }
                    elif itype == "function_call_output":
                        _flush_pending()
                        output = item.get("output", "")
                        if isinstance(output, list):
                            output = "".join(
                                (p.get("text", "") if isinstance(p, dict) else "")
                                for p in output
                                if isinstance(p, dict) and p.get("type") in ("input_text", "output_text")
                            )
                        messages.append({"role": "tool", "tool_call_id": item.get("call_id", ""), "content": str(output)})
                    elif itype == "reasoning":
                        encrypted = item.get("encrypted_content", "") or ""
                        if encrypted and pending is not None and pending.get("role") == "assistant":
                            pending["reasoning_content"] = encrypted
                            if pending.get("content") is None and not pending.get("tool_calls"):
                                pending["content"] = ""
                        elif encrypted:
                            _flush_pending()
                            pending = {"role": "assistant", "content": "", "reasoning_content": encrypted}
                else:
                    itype = getattr(item, "type", "message")
                    if hasattr(item, "role"):
                        role = item.role
                        if role in ("system", "developer"):
                            content = _flatten_input(item.content)
                            txt = content if isinstance(content, str) else "".join(
                                p.get("text", "") for p in content if p.get("type") == "text"
                            )
                            if txt:
                                messages.append({"role": "system", "content": txt})
                        elif role == "assistant":
                            if pending is not None:
                                _flush_pending()
                            content = _flatten_input(item.content)
                            if isinstance(content, str):
                                pending = {"role": "assistant", "content": content}
                            else:
                                tc = [p for p in content if p.get("type") == "tool_use"]
                                txt_parts = [p for p in content if p.get("type") == "text"]
                                txt = "".join(p.get("text", "") for p in txt_parts)
                                msg: dict[str, Any] = {"role": "assistant", "content": txt if txt else None}
                                if tc:
                                    msg["tool_calls"] = [
                                        {"id": tcu["id"], "type": "function", "function": {"name": tcu["name"], "arguments": json.dumps(tcu.get("input", {}), ensure_ascii=False)}}
                                        for tcu in tc
                                    ]
                                pending = msg
                        elif role == "tool":
                            _flush_pending()
                            content = item.content
                            if not isinstance(content, str):
                                content = "".join(
                                    p.text if p.type in ("input_text", "output_text") else ""
                                    for p in (content if isinstance(content, list) else [])
                                    if hasattr(p, "type") and p.type in ("input_text", "output_text")
                                )
                            messages.append({"role": "tool", "tool_call_id": item.call_id if hasattr(item, "call_id") else "", "content": str(content)})
                        else:
                            _flush_pending()
                            content = _flatten_input(item.content)
                            messages.append({"role": role, "content": content})
                    elif itype == "function_call":
                        if pending is not None and pending.get("role") == "assistant":
                            tc_list = pending.setdefault("tool_calls", [])
                            tc_list.append({
                                "id": item.call_id,
                                "type": "function",
                                "function": {"name": item.name, "arguments": item.arguments},
                            })
                        else:
                            _flush_pending()
                            pending = {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [{
                                    "id": item.call_id,
                                    "type": "function",
                                    "function": {"name": item.name, "arguments": item.arguments},
                                }],
                            }
                    elif itype == "function_call_output":
                        _flush_pending()
                        output = item.output
                        if isinstance(output, list):
                            output = "".join(
                                i.text if hasattr(i, "text") and i.type in ("input_text", "output_text") else ""
                                for i in output
                            )
                        messages.append({"role": "tool", "tool_call_id": item.call_id, "content": str(output)})
                    elif itype == "reasoning":
                        encrypted = item.encrypted_content or ""
                        if encrypted and pending is not None and pending.get("role") == "assistant":
                            pending["reasoning_content"] = encrypted
                            if pending.get("content") is None and not pending.get("tool_calls"):
                                pending["content"] = ""
                        elif encrypted:
                            _flush_pending()
                            pending = {"role": "assistant", "content": "", "reasoning_content": encrypted}

        if isinstance(request.input, str):
            _flush_pending()
            messages.append({"role": "user", "content": request.input})
        else:
            _process_items(request.input)

        if request.previous_response_id:
            cached = self._response_cache.get(request.previous_response_id)
            if cached:
                for msg in cached.get("messages", []):
                    if msg["role"] not in ("user", "assistant", "tool"):
                        continue
                    if msg["role"] == "assistant" and pending is not None and pending.get("role") == "assistant":
                        messages.append(pending)
                        pending = None
                    messages.append(msg)
                _flush_pending()

        _flush_pending()

        _remove_orphan_tool_messages(messages)
        _ensure_tool_calls_have_outputs(messages)

        payload: dict[str, Any] = {
            "model": self.map_model(request.model),
            "messages": messages,
            "stream": request.stream or False,
        }

        if request.stream:
            payload["stream_options"] = {"include_usage": True}

        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.top_p is not None:
            payload["top_p"] = request.top_p
        if request.max_output_tokens is not None:
            payload["max_completion_tokens"] = request.max_output_tokens

        if request.reasoning:
            effort = request.reasoning.effort or "medium"
            payload["thinking"] = {"type": "enabled"}
            payload["reasoning_effort"] = "high" if effort in ("medium", "low", "minimal") else "max"
            if "temperature" in payload:
                del payload["temperature"]
            if "top_p" in payload:
                del payload["top_p"]
        else:
            payload["thinking"] = {"type": "enabled"}
            payload["reasoning_effort"] = "high"
            if "temperature" in payload:
                del payload["temperature"]
            if "top_p" in payload:
                del payload["top_p"]

        if request.tools:
            chat_tools: list[dict[str, Any]] = []
            for t in request.tools:
                chat_tools.extend(_translate_tool(t))
            if chat_tools:
                payload["tools"] = chat_tools
                tc = request.tool_choice
                if tc is not None:
                    if isinstance(tc, str):
                        payload["tool_choice"] = tc
                    elif hasattr(tc, "type") and tc.type == "function":
                        name = tc.name
                        if tc.function and hasattr(tc.function, "name"):
                            name = tc.function.name
                        payload["tool_choice"] = {"type": "function", "function": {"name": name}}
                    elif isinstance(tc, dict) and tc.get("type") == "function":
                        name = tc.get("function", {}).get("name", tc.get("name", ""))
                        payload["tool_choice"] = {"type": "function", "function": {"name": name}}

        if request.parallel_tool_calls is not None:
            payload["parallel_tool_calls"] = request.parallel_tool_calls

        return payload

    async def convert_response(self, response_data: dict[str, Any], req: ResponseRequest) -> Response:
        choice = (response_data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        finish_reason = choice.get("finish_reason", "stop")

        output: list[Any] = []

        reasoning_text = message.get("reasoning_content", "") or ""
        if reasoning_text:
            reasoning_id = self._generate_id("rsn_")
            output.append(ReasoningItem(
                id=reasoning_id,
                summary=[ReasoningSummaryPart(text=reasoning_text)],
                encrypted_content=reasoning_text,
                status="completed",
            ))

        text = message.get("content", "") or ""
        if text:
            output.append(OutputMessage(
                id=self._generate_id("msg_"),
                content=[OutputText(text=text)],
            ))

        tool_calls = message.get("tool_calls") or []
        for tc in tool_calls:
            fn = tc.get("function", {})
            output.append(FunctionCall(
                id=self._generate_id("fc_"),
                call_id=tc.get("id", ""),
                name=fn.get("name", ""),
                arguments=fn.get("arguments", ""),
                status="completed",
            ))

        if not output:
            output.append(OutputMessage(
                id=self._generate_id("msg_"),
                content=[OutputText(text="")],
            ))

        usage_data = response_data.get("usage") or {}
        usage = Usage(
            input_tokens=usage_data.get("prompt_tokens", 0),
            output_tokens=usage_data.get("completion_tokens", 0),
            total_tokens=usage_data.get("total_tokens", 0),
        )
        if usage_data.get("prompt_tokens_details"):
            usage.input_tokens_details = usage_data["prompt_tokens_details"]
        if usage_data.get("completion_tokens_details"):
            usage.output_tokens_details = usage_data["completion_tokens_details"]

        status: Literal["completed", "incomplete"] = "completed"
        incomplete = None
        if finish_reason == "length":
            status = "incomplete"
            incomplete = {"reason": "max_output_tokens"}

        return Response(
            id=self._generate_id("resp_"),
            model=req.model,
            output=output,
            usage=usage,
            status=status,
            incomplete_details=incomplete,
            metadata=req.metadata,
        )

    async def convert_stream(self, lines: AsyncIterator[str], req: ResponseRequest) -> AsyncIterator[str]:
        resp_id = self._generate_id("resp_")
        created_at = int(time.time())
        model = req.model
        _emit = lambda e, d: f"event: {e}\ndata: {json.dumps(d, ensure_ascii=False)}\n\n"

        def _build_snapshot(status, out, usage):
            return {
                "id": resp_id, "object": "response", "created_at": created_at, "status": status,
                "model": model, "output": out,
                "usage": usage.model_dump(mode="json") if usage else None,
                "parallel_tool_calls": req.parallel_tool_calls if req.parallel_tool_calls is not None else True,
                "tool_choice": req.tool_choice if req.tool_choice is not None else "auto",
                "reasoning": {"effort": req.reasoning.effort if req.reasoning else None, "summary": req.reasoning.summary if req.reasoning else None},
                "text": req.text if req.text else {"format": {"type": "text"}},
                "truncation": req.truncation or "disabled",
                "incomplete_details": None,
                "error": None,
                "metadata": req.metadata,
                "previous_response_id": req.previous_response_id,
                "instructions": req.instructions,
                "temperature": req.temperature,
                "top_p": req.top_p,
                "max_output_tokens": req.max_output_tokens,
                "tools": [t if isinstance(t, dict) else t.model_dump(mode="json") if hasattr(t, "model_dump") else t for t in (req.tools or [])],
            }

        yield _emit("response.created", {
            "type": "response.created",
            "sequence_number": 0,
            "response": _build_snapshot("in_progress", [], None),
        })
        yield _emit("response.in_progress", {
            "type": "response.in_progress",
            "sequence_number": 1,
            "response": _build_snapshot("in_progress", [], None),
        })

        seq = 2
        output_index = 0
        active_kind: str | None = None
        active_id = ""
        active_buffer = ""
        reasoning_buffer = ""
        tool_calls: dict[int, dict[str, Any]] = {}
        final_output: list[Any] = []
        usage_data: dict[str, Any] | None = None
        finish_reason: str | None = None

        def _finalize_active():
            nonlocal active_kind, active_id, active_buffer, reasoning_buffer, output_index, seq
            if active_kind is None:
                return
            oi = output_index - 1
            if active_kind == "message":
                yield _emit("response.output_text.done", {
                    "type": "response.output_text.done", "sequence_number": seq,
                    "item_id": active_id, "output_index": oi, "content_index": 0, "text": active_buffer,
                })
                seq += 1
                yield _emit("response.content_part.done", {
                    "type": "response.content_part.done", "sequence_number": seq,
                    "item_id": active_id, "output_index": oi, "content_index": 0,
                    "part": {"type": "output_text", "text": active_buffer, "annotations": []},
                })
                seq += 1
                final_output.append({"id": active_id, "type": "message", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": active_buffer, "annotations": []}]})
                yield _emit("response.output_item.done", {
                    "type": "response.output_item.done", "sequence_number": seq,
                    "output_index": oi, "item": final_output[-1],
                })
                seq += 1
            elif active_kind == "reasoning":
                yield _emit("response.reasoning_summary_text.done", {
                    "type": "response.reasoning_summary_text.done", "sequence_number": seq,
                    "item_id": active_id, "output_index": oi, "summary_index": 0, "text": reasoning_buffer,
                })
                seq += 1
                yield _emit("response.reasoning_summary_part.done", {
                    "type": "response.reasoning_summary_part.done", "sequence_number": seq,
                    "item_id": active_id, "output_index": oi, "summary_index": 0,
                    "part": {"type": "summary_text", "text": reasoning_buffer},
                })
                seq += 1
                final_output.append({"id": active_id, "type": "reasoning", "summary": [{"type": "summary_text", "text": reasoning_buffer}], "encrypted_content": reasoning_buffer, "status": "completed"})
                yield _emit("response.output_item.done", {
                    "type": "response.output_item.done", "sequence_number": seq,
                    "output_index": oi, "item": final_output[-1],
                })
                seq += 1
            active_kind = None
            active_id = ""
            active_buffer = ""
            reasoning_buffer = ""

        def _open_message():
            nonlocal active_kind, active_id, active_buffer, output_index, seq
            for _ in _finalize_active():
                yield _
            active_kind = "message"
            active_id = self._generate_id("msg_")
            active_buffer = ""
            oi = output_index
            output_index += 1
            yield _emit("response.output_item.added", {
                "type": "response.output_item.added", "sequence_number": seq,
                "output_index": oi, "item": {"id": active_id, "type": "message", "role": "assistant", "status": "in_progress", "content": []},
            })
            seq += 1
            yield _emit("response.content_part.added", {
                "type": "response.content_part.added", "sequence_number": seq,
                "item_id": active_id, "output_index": oi, "content_index": 0,
                "part": {"type": "output_text", "text": "", "annotations": []},
            })
            seq += 1

        def _open_reasoning():
            nonlocal active_kind, active_id, reasoning_buffer, output_index, seq
            for _ in _finalize_active():
                yield _
            active_kind = "reasoning"
            active_id = self._generate_id("rsn_")
            reasoning_buffer = ""
            oi = output_index
            output_index += 1
            yield _emit("response.output_item.added", {
                "type": "response.output_item.added", "sequence_number": seq,
                "output_index": oi, "item": {"id": active_id, "type": "reasoning", "summary": [], "encrypted_content": None, "status": "in_progress"},
            })
            seq += 1
            yield _emit("response.reasoning_summary_part.added", {
                "type": "response.reasoning_summary_part.added", "sequence_number": seq,
                "item_id": active_id, "output_index": oi, "summary_index": 0,
                "part": {"type": "summary_text", "text": ""},
            })
            seq += 1

        try:
            async for line in lines:
                line = line.strip()
                if line == "data: [DONE]" or line == "[DONE]":
                    break
                if not line.startswith("data: "):
                    continue
                try:
                    chunk = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                if chunk.get("usage"):
                    u = chunk["usage"]
                    usage_data = {
                        "prompt_tokens": u.get("prompt_tokens", 0),
                        "completion_tokens": u.get("completion_tokens", 0),
                        "total_tokens": u.get("total_tokens", 0),
                        "prompt_tokens_details": u.get("prompt_tokens_details"),
                        "completion_tokens_details": u.get("completion_tokens_details"),
                    }

                choice = (chunk.get("choices") or [{}])[0]
                delta = choice.get("delta", {})
                finish = choice.get("finish_reason")
                if finish:
                    finish_reason = finish

                rc = delta.get("reasoning_content", "") or ""
                if rc:
                    if active_kind != "reasoning":
                        for ev in _open_reasoning():
                            yield ev
                    reasoning_buffer += rc
                    yield _emit("response.reasoning_summary_text.delta", {
                        "type": "response.reasoning_summary_text.delta", "sequence_number": seq,
                        "item_id": active_id, "output_index": output_index - 1, "summary_index": 0, "delta": rc,
                    })
                    seq += 1

                content = delta.get("content", "") or ""
                if content:
                    if active_kind != "message":
                        for ev in _open_message():
                            yield ev
                    active_buffer += content
                    yield _emit("response.output_text.delta", {
                        "type": "response.output_text.delta", "sequence_number": seq,
                        "item_id": active_id, "output_index": output_index - 1, "content_index": 0, "delta": content,
                    })
                    seq += 1

                tc_deltas = delta.get("tool_calls") or []
                for tc_d in tc_deltas:
                    idx = tc_d.get("index", 0)
                    if idx not in tool_calls:
                        for _ in _finalize_active():
                            yield _
                        fc_id = self._generate_id("fc_")
                        oi = output_index
                        output_index += 1
                        tool_calls[idx] = {"item_id": fc_id, "output_index": oi, "call_id": tc_d.get("id", ""), "name": tc_d.get("function", {}).get("name", ""), "args": ""}
                        yield _emit("response.output_item.added", {
                            "type": "response.output_item.added", "sequence_number": seq,
                            "output_index": oi,
                            "item": {"id": fc_id, "type": "function_call", "call_id": tool_calls[idx]["call_id"], "name": tool_calls[idx]["name"], "arguments": "", "status": "in_progress"},
                        })
                        seq += 1
                    tc = tool_calls[idx]
                    fn = tc_d.get("function", {})
                    if fn.get("name") and not tc["name"]:
                        tc["name"] = fn["name"]
                    args_delta = fn.get("arguments", "") or ""
                    if args_delta:
                        tc["args"] += args_delta
                        yield _emit("response.function_call_arguments.delta", {
                            "type": "response.function_call_arguments.delta", "sequence_number": seq,
                            "item_id": tc["item_id"], "output_index": tc["output_index"], "delta": args_delta,
                        })
                        seq += 1

                if finish:
                    for idx in sorted(tool_calls.keys()):
                        tc = tool_calls[idx]
                        yield _emit("response.function_call_arguments.done", {
                            "type": "response.function_call_arguments.done", "sequence_number": seq,
                            "item_id": tc["item_id"], "output_index": tc["output_index"], "arguments": tc["args"],
                        })
                        seq += 1
                        item = {"id": tc["item_id"], "type": "function_call", "call_id": tc["call_id"], "name": tc["name"], "arguments": tc["args"], "status": "completed"}
                        final_output.append(item)
                        yield _emit("response.output_item.done", {
                            "type": "response.output_item.done", "sequence_number": seq,
                            "output_index": tc["output_index"], "item": item,
                        })
                        seq += 1

        except Exception as exc:
            for ev in _finalize_active():
                yield ev
            for idx in sorted(tool_calls.keys()):
                tc = tool_calls[idx]
                yield _emit("response.function_call_arguments.done", {
                    "type": "response.function_call_arguments.done", "sequence_number": seq,
                    "item_id": tc["item_id"], "output_index": tc["output_index"], "arguments": tc["args"],
                })
                seq += 1
            snapshot = _build_snapshot("failed", final_output, None)
            snapshot["error"] = {"type": "upstream_error", "message": str(exc)}
            yield _emit("response.failed", {
                "type": "response.failed", "sequence_number": seq,
                "response": snapshot,
            })
            return

        for ev in _finalize_active():
            yield ev

        status_str = "completed" if not finish_reason or finish_reason == "stop" else "incomplete"
        incomp = {"reason": "max_output_tokens"} if finish_reason == "length" else None

        usage = None
        if usage_data:
            usage = Usage(
                input_tokens=usage_data.get("prompt_tokens", 0),
                output_tokens=usage_data.get("completion_tokens", 0),
                total_tokens=usage_data.get("total_tokens", 0),
            )
            if usage_data.get("prompt_tokens_details"):
                usage.input_tokens_details = usage_data["prompt_tokens_details"]
            if usage_data.get("completion_tokens_details"):
                usage.output_tokens_details = usage_data["completion_tokens_details"]

        snapshot = _build_snapshot(status_str, final_output, usage)
        snapshot["incomplete_details"] = incomp
        yield _emit("response.completed", {
            "type": "response.completed", "sequence_number": seq,
            "response": snapshot,
        })


def _remove_orphan_tool_messages(messages: list[dict[str, Any]]):
    valid_ids: set[str] | None = None
    i = 0
    while i < len(messages):
        m = messages[i]
        if m["role"] == "assistant":
            tcs = m.get("tool_calls", [])
            valid_ids = {tc["id"] for tc in tcs if tc.get("id")} if tcs else None
            i += 1
        elif m["role"] == "tool":
            if valid_ids and m.get("tool_call_id") in valid_ids:
                i += 1
            else:
                messages.pop(i)
        else:
            valid_ids = None
            i += 1


def _ensure_tool_calls_have_outputs(messages: list[dict[str, Any]]):
    for i, m in enumerate(messages):
        if m["role"] != "assistant":
            continue
        tcs = m.get("tool_calls", [])
        if not tcs:
            continue
        seen: set[str] = set()
        j = i + 1
        while j < len(messages) and messages[j]["role"] == "tool":
            tcid = messages[j].get("tool_call_id", "")
            if tcid:
                seen.add(tcid)
            j += 1
        for tc in tcs:
            if tc["id"] not in seen:
                messages.insert(j, {"role": "tool", "tool_call_id": tc["id"], "content": "[tool output missing]"})
                j += 1
