import pytest
from deepseek2responses.converters.base import BaseConverter


class TestBaseConverter:
    def test_generate_id(self):
        class DummyConverter(BaseConverter):
            async def convert_request(self, request):
                pass

            async def convert_response(self, response_data, model):
                pass

            async def convert_stream(self, response_stream, model):
                pass

        conv = DummyConverter("test", "sk-test", "https://api.test.com", {})
        resp_id = conv.generate_id("resp_")
        assert resp_id.startswith("resp_")
        assert len(resp_id) == 29  # "resp_" + 12 hex chars = 5 + 24 = 29

    def test_map_model(self):
        class DummyConverter(BaseConverter):
            async def convert_request(self, request):
                pass

            async def convert_response(self, response_data, model):
                pass

            async def convert_stream(self, response_stream, model):
                pass

        conv = DummyConverter("test", "sk-test", "https://api.test.com", {"gpt-4": "model-x"})
        assert conv.map_model("gpt-4") == "model-x"
        assert conv.map_model("unknown") == "unknown"
