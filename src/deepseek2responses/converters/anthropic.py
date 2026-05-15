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
