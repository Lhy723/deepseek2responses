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
    # Use AnthropicConverter for deepseekv4 (DeepSeek's Anthropic API format)
    if name == "deepseekv4":
        return AnthropicConverter(name, provider.api_key, provider.base_url, provider.model_mapping)
    elif name == "deepseek":
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
    # deepseekv4 uses DeepSeek's Anthropic API format: /anthropic/v1/messages
    if converter.name == "deepseekv4":
        upstream_url = f"{converter.base_url}/anthropic/v1/messages"
    elif converter.name == "anthropic":
        upstream_url = f"{converter.base_url}/v1/messages"
    else:
        upstream_url = f"{converter.base_url}/v1/chat/completions"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {converter.api_key}",
    }
    if converter.name in ("anthropic", "deepseekv4"):
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
