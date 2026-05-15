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
        return f"{prefix}{secrets.token_hex(12)}"

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
