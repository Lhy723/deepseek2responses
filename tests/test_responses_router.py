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
                    model_mapping={"gpt-4.1": "deepseek-v4-pro"},
                )
            },
            default_provider="deepseek",
        )
        app = create_app(config)
        return TestClient(app)

    def test_responses_non_streaming(self, client):
        # Anthropic API format response
        mock_response = {
            "content": [{"type": "text", "text": "Hello!"}],
            "usage": {"input_tokens": 5, "output_tokens": 2},
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
        # Anthropic API format SSE events
        sse_lines = [
            'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "He"}}',
            'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "llo"}}',
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
