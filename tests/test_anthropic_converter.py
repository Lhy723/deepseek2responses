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
