import pytest
from pathlib import Path
from deepseek2responses.config import load_config, Config, ServerConfig, ProviderConfig


class TestConfig:
    def test_load_config(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("""
server:
  host: "127.0.0.1"
  port: 9090
providers:
  deepseek:
    api_key: "sk-test"
    base_url: "https://api.deepseek.com"
    model_mapping:
      "gpt-4.1": "deepseek-chat"
default_provider: "deepseek"
""")
        config = load_config(str(config_path))
        assert config.server.host == "127.0.0.1"
        assert config.server.port == 9090
        assert config.providers["deepseek"].api_key == "sk-test"
        assert config.providers["deepseek"].model_mapping["gpt-4.1"] == "deepseek-chat"
        assert config.default_provider == "deepseek"

    def test_load_config_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            load_config("/nonexistent/config.yaml")
