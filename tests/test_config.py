import pytest
from pathlib import Path
from deepseek2responses.config import load_config, Config


class TestConfig:
    def test_load_config_from_file(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("""
deepseek_api_key: "sk-test"
deepseek_base_url: "https://api.deepseek.com"
host: "127.0.0.1"
port: 9090
model_mapping:
  "gpt-4.1": "deepseek-chat"
""")
        config = load_config(str(config_path))
        assert config.deepseek_api_key == "sk-test"
        assert config.host == "127.0.0.1"
        assert config.port == 9090
        assert config.model_mapping["gpt-4.1"] == "deepseek-chat"

    def test_load_config_defaults_when_no_file(self, tmp_path: Path):
        nonexistent = str(tmp_path / "nonexistent.yaml")
        config = load_config(nonexistent)
        assert config.host == "0.0.0.0"
        assert config.port == 19199
        assert config.deepseek_api_key == ""

    def test_env_var_override(self, tmp_path: Path, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-from-env")
        config = load_config(str(tmp_path / "nonexistent.yaml"))
        assert config.deepseek_api_key == "sk-from-env"

    def test_file_takes_precedence_over_env(self, tmp_path: Path, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-from-env")
        config_path = tmp_path / "config.yaml"
        config_path.write_text('deepseek_api_key: "sk-from-file"')
        config = load_config(str(config_path))
        assert config.deepseek_api_key == "sk-from-file"
