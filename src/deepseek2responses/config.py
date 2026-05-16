from __future__ import annotations

import os
from pathlib import Path

import yaml
from pydantic import BaseModel

CONFIG_DIR = Path.home() / ".deepseek2responses"
CONFIG_FILE = CONFIG_DIR / "config.yaml"


class Config(BaseModel):
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    model_mapping: dict[str, str] = {}
    host: str = "0.0.0.0"
    port: int = 19199
    api_key: str | None = None


def load_config(path: str | None = None) -> Config:
    if path is None:
        path = os.environ.get("DEEPSEEK2RESPONSES_CONFIG", str(CONFIG_FILE))

    config_path = Path(path)
    if config_path.exists():
        with open(config_path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    else:
        data = {}

    env_api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if env_api_key:
        data.setdefault("deepseek_api_key", env_api_key)

    return Config(**data)


def save_config(config: Config, path: str | None = None) -> str:
    target = Path(path or str(CONFIG_FILE))
    target.parent.mkdir(parents=True, exist_ok=True)
    data = {"deepseek_api_key": config.deepseek_api_key}
    if config.deepseek_base_url != "https://api.deepseek.com/v1":
        data["deepseek_base_url"] = config.deepseek_base_url
    if config.host != "0.0.0.0":
        data["host"] = config.host
    if config.port != 19199:
        data["port"] = config.port
    if config.api_key:
        data["api_key"] = config.api_key
    if config.model_mapping:
        data["model_mapping"] = config.model_mapping
    with open(target, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, default_flow_style=False)
    return str(target)
