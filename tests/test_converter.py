import pytest
from deepseek2responses.converter import DeepSeekConverter
from deepseek2responses.models import ResponseRequest


class TestDeepSeekConverter:
    @pytest.fixture
    def converter(self):
        return DeepSeekConverter("sk-test", "https://api.deepseek.com/v1", {"gpt-4.1": "deepseek-v4-pro"})

    def test_upstream_url(self, converter):
        assert converter.upstream_url == "https://api.deepseek.com/v1/chat/completions"

    def test_auth_headers(self, converter):
        h = converter.auth_headers
        assert h["Authorization"] == "Bearer sk-test"
        assert h["Content-Type"] == "application/json"

    def test_map_model(self, converter):
        assert converter.map_model("gpt-4.1") == "deepseek-v4-pro"
        assert converter.map_model("unknown") == "unknown"

    @pytest.mark.asyncio
    async def test_convert_request_string_input(self, converter):
        req = ResponseRequest(model="gpt-4.1", input="Hello")
        result = await converter.convert_request(req)
        assert result["model"] == "deepseek-v4-pro"
        assert result["messages"] == [{"role": "user", "content": "Hello"}]
        assert result["thinking"] == {"type": "enabled"}
        assert result["reasoning_effort"] == "high"

    @pytest.mark.asyncio
    async def test_convert_request_with_instructions(self, converter):
        req = ResponseRequest(model="gpt-4.1", input="Hello", instructions="Be helpful")
        result = await converter.convert_request(req)
        assert result["messages"][0]["role"] == "system"
        assert result["messages"][0]["content"] == "Be helpful"
        assert result["messages"][1]["role"] == "user"

    @pytest.fixture
    def req(self):
        return ResponseRequest(model="gpt-4.1", input="Hello")

    @pytest.mark.asyncio
    async def test_convert_response(self, converter, req):
        upstream = {
            "choices": [{"message": {"role": "assistant", "content": "Hi there"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        resp = await converter.convert_response(upstream, req)
        assert resp.status == "completed"
        assert resp.model == "gpt-4.1"
        assert resp.output[0].content[0].text == "Hi there"
        assert resp.usage.total_tokens == 15

    @pytest.mark.asyncio
    async def test_convert_response_with_reasoning(self, converter, req):
        upstream = {
            "choices": [{"message": {"role": "assistant", "content": "Answer", "reasoning_content": "Let me think..."}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        }
        resp = await converter.convert_response(upstream, req)
        assert resp.output[0].type == "reasoning"
        assert resp.output[0].encrypted_content == "Let me think..."
        assert resp.output[1].type == "message"
        assert resp.output[1].content[0].text == "Answer"

    @pytest.mark.asyncio
    async def test_convert_response_finish_length(self, converter, req):
        upstream = {
            "choices": [{"message": {"content": "truncated"}, "finish_reason": "length"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        resp = await converter.convert_response(upstream, req)
        assert resp.status == "incomplete"
        assert resp.incomplete_details == {"reason": "max_output_tokens"}

    @pytest.mark.asyncio
    async def test_convert_stream(self, converter, req):
        async def mock_lines():
            yield 'data: {"choices": [{"delta": {"content": "He"}, "index": 0}]}'
            yield 'data: {"choices": [{"delta": {"content": "llo"}, "index": 0, "finish_reason": "stop"}]}'
            yield "data: [DONE]"

        events = []
        async for event in converter.convert_stream(mock_lines(), req):
            events.append(event)
        assert any("response.created" in e for e in events)
        assert any("response.output_text.delta" in e for e in events)
        assert any("response.completed" in e for e in events)

    @pytest.mark.asyncio
    async def test_convert_stream_with_reasoning(self, converter, req):
        async def mock_lines():
            yield 'data: {"choices": [{"delta": {"reasoning_content": "Hmm..."}, "index": 0}]}'
            yield 'data: {"choices": [{"delta": {"content": "OK"}, "index": 0, "finish_reason": "stop"}]}'
            yield "data: [DONE]"

        events = []
        async for event in converter.convert_stream(mock_lines(), req):
            events.append(event)
        assert any("reasoning_summary_text.delta" in e for e in events)
        assert any("response.output_text.delta" in e for e in events)

    @pytest.mark.asyncio
    async def test_convert_request_tool_calls(self, converter):
        req = ResponseRequest(
            model="gpt-4.1", input="Hi",
            tools=[{"type": "function", "name": "get_weather", "parameters": {"type": "object", "properties": {}}}],
        )
        result = await converter.convert_request(req)
        tools = result.get("tools", [])
        assert len(tools) == 1
        assert tools[0]["function"]["name"] == "get_weather"
