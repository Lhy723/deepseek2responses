from __future__ import annotations

import os
from pathlib import Path
from typing import Dict

import yaml
from pydantic import BaseModel


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8080


class ProviderConfig(BaseModel):
    api_key: str
    base_url: str
    model_mapping: Dict[str, str] = {}


class Config(BaseModel):
    server: ServerConfig = ServerConfig()
    providers: Dict[str, ProviderConfig]
    default_provider: str


def load_config(path: str | None = None) -> Config:
    if path is None:
        path = os.environ.get("DEEPSEEK2RESPONSES_CONFIG", "config.yaml")

    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    return Config(**data)
