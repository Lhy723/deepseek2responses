import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from deepseek2responses.main import create_app
from deepseek2responses.config import Config


class TestRouter:
    @pytest.fixture
    def client(self):
        config = Config(deepseek_api_key="sk-test", model_mapping={"gpt-4.1": "deepseek-v4-pro"})
        app = create_app(config, api_key=None)
        return TestClient(app)

    def test_responses_non_streaming(self, client):
        mock_response = {
            "choices": [{"message": {"role": "assistant", "content": "Hello!"}, "finish_reason": "stop"}],
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
        async def mock_aiter_lines():
            yield 'data: {"choices": [{"delta": {"content": "He"}, "index": 0}]}'
            yield 'data: {"choices": [{"delta": {"content": "llo"}, "index": 0, "finish_reason": "stop"}]}'
            yield "data: [DONE]"

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

    def test_unauthorized_without_token(self):
        config = Config(deepseek_api_key="sk-test", api_key="secret-token")
        app = create_app(config, api_key="secret-token")
        client = TestClient(app)
        response = client.post("/v1/responses", json={"model": "gpt-4.1", "input": "Hi"})
        assert response.status_code == 401

    def test_authorized_with_token(self):
        config = Config(deepseek_api_key="sk-test", api_key="secret-token")
        app = create_app(config, api_key="secret-token")
        client = TestClient(app)
        mock_response = {
            "choices": [{"message": {"role": "assistant", "content": "Hello!"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
        }
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value.status_code = 200
            mock_post.return_value.json = lambda: mock_response
            mock_post.return_value.aiter_lines = AsyncMock(return_value=[])
            mock_post.return_value.headers = {"content-type": "application/json"}

            response = client.post(
                "/v1/responses", json={"model": "gpt-4.1", "input": "Hi"},
                headers={"Authorization": "Bearer secret-token"},
            )
            assert response.status_code == 200
