import pytest
from deepseek2responses.main import create_app
from deepseek2responses.config import Config


class TestMain:
    def test_create_app(self):
        config = Config(deepseek_api_key="sk-test")
        app = create_app(config, api_key=None)
        assert app is not None
        assert app.state.converter is not None
        assert app.state.config == config
