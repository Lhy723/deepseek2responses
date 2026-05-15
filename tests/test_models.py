import pytest
from deepseek2responses.models import (
    ResponseRequest,
    Response,
    OutputMessage,
    OutputText,
    Usage,
)


class TestModels:
    def test_response_request_basic(self):
        req = ResponseRequest(model="gpt-4.1", input="Hello")
        assert req.model == "gpt-4.1"
        assert req.input == "Hello"
        assert req.stream is False

    def test_response_request_with_messages(self):
        req = ResponseRequest(
            model="gpt-4.1",
            input=[{"role": "user", "content": "Hello"}],
        )
        assert isinstance(req.input, list)

    def test_response_basic(self):
        resp = Response(
            id="resp_test",
            model="gpt-4.1",
            output=[
                OutputMessage(
                    role="assistant",
                    content=[OutputText(text="Hi there")],
                )
            ],
            usage=Usage(input_tokens=10, output_tokens=5, total_tokens=15),
        )
        assert resp.status == "completed"
        assert resp.usage.total_tokens == 15
