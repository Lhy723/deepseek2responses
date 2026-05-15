import pytest
from deepseek2responses.main import create_app
from deepseek2responses.config import Config, ServerConfig, ProviderConfig


class TestMain:
    def test_create_app(self):
        config = Config(
            server=ServerConfig(),
            providers={
                "deepseek": ProviderConfig(
                    api_key="sk-test",
                    base_url="https://api.deepseek.com",
                    model_mapping={},
                )
            },
            default_provider="deepseek",
        )
        app = create_app(config)
        assert app is not None
