from __future__ import annotations

import json

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

import logging

from deepseek2responses.converter import DeepSeekConverter
from deepseek2responses.models import ErrorResponse, ResponseRequest

logger = logging.getLogger("deepseek2responses")
router = APIRouter()


def verify_api_key(request: Request) -> None:
    api_key = getattr(request.app.state, "api_key", None)
    if api_key is None:
        return
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth[7:] != api_key:
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "unauthorized", "message": "Invalid or missing API key"}},
        )


async def _handle_responses(request: Request, body: ResponseRequest):
    logger.info(f"REQ model={body.model} stream={body.stream} input_len={len(str(body.input))}")
    logger.info(f"REQ headers: {dict(request.headers)}")
    converter: DeepSeekConverter = request.app.state.converter
    upstream_request = await converter.convert_request(body)
    logger.info(f"UPSTREAM model={upstream_request.get('model')} msgs={len(upstream_request.get('messages',[]))}")

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            if body.stream:
                upstream_response = await client.post(
                    converter.upstream_url,
                    json=upstream_request,
                    headers=converter.auth_headers,
                    timeout=300.0,
                )
                upstream_response.raise_for_status()
                return StreamingResponse(
                    converter.convert_stream(upstream_response.aiter_lines(), body),
                    media_type="text/event-stream",
                )
            else:
                upstream_response = await client.post(
                    converter.upstream_url,
                    json=upstream_request,
                    headers=converter.auth_headers,
                    timeout=300.0,
                )
                upstream_response.raise_for_status()
                upstream_data = upstream_response.json()
                result = await converter.convert_response(upstream_data, body)
                converter._cache_put(result.id, {"messages": upstream_request.get("messages", [])})
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


router.post("/v1/responses", dependencies=[Depends(verify_api_key)])(_handle_responses)
router.post("/responses", dependencies=[Depends(verify_api_key)])(_handle_responses)


@router.get("/v1/models")
async def _list_models(request: Request):
    converter: DeepSeekConverter = request.app.state.converter
    models = []
    for client_model, upstream_model in converter.model_mapping.items():
        models.append({"id": client_model, "object": "model", "owned_by": "deepseek"})
    if not models:
        models = [
            {"id": "deepseek-v4-pro", "object": "model", "owned_by": "deepseek"},
            {"id": "deepseek-v4-flash", "object": "model", "owned_by": "deepseek"},
        ]
    return JSONResponse({"object": "list", "data": models})


@router.get("/")
async def _healthz():
    return JSONResponse({"ok": True, "name": "deepseek2responses"})


@router.options("/{path:path}")
async def _options_preflight(path: str):
    return JSONResponse({"ok": True})
