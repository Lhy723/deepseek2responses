import pytest
from deepseek2responses.converters.deepseek import DeepSeekConverter
from deepseek2responses.models import ResponseRequest


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
