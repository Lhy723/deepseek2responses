from __future__ import annotations

import argparse
import secrets
import sys

import uvicorn
from fastapi import FastAPI

from deepseek2responses.config import Config, load_config, save_config, CONFIG_FILE
from deepseek2responses.converter import DeepSeekConverter
from deepseek2responses.router import router


def create_app(config: Config, api_key: str | None) -> FastAPI:
    app = FastAPI(
        title="deepseek2responses",
        description="Convert DeepSeek API to OpenAI Responses API",
        version="0.1.0",
    )
    app.state.config = config
    app.state.api_key = api_key
    app.state.converter = DeepSeekConverter(
        api_key=config.deepseek_api_key,
        base_url=config.deepseek_base_url,
        model_mapping=config.model_mapping,
    )
    app.include_router(router)
    return app


def _first_run_wizard() -> Config:
    print("First run — configure your DeepSeek API key.")
    print("Get one at https://platform.deepseek.com/api_keys")
    print()
    key = ""
    while not key.strip():
        key = input("DeepSeek API key: ").strip()
    proxy_key = secrets.token_urlsafe(32)
    config = Config(deepseek_api_key=key, api_key=proxy_key)
    path = save_config(config)
    print(f"Config saved to {path}")
    print()
    return config


def main() -> None:
    parser = argparse.ArgumentParser(description="deepseek2responses proxy server")
    parser.add_argument("--config", "-c", type=str, default=None, help="Path to config file")
    parser.add_argument("--port", "-p", type=int, default=None, help="Server port")
    parser.add_argument("--version", "-v", action="store_true", help="Show version")
    parser.add_argument("--no-auth", action="store_true", help="Disable API key authentication")
    args = parser.parse_args()

    if args.version:
        from deepseek2responses import __version__
        print(f"deepseek2responses v{__version__}")
        sys.exit(0)

    config = load_config(args.config)

    if not config.deepseek_api_key:
        if CONFIG_FILE.exists() or args.config:
            print(f"Error: deepseek_api_key not set in {args.config or CONFIG_FILE}")
            print("Add 'deepseek_api_key: \"sk-your-key\"' to the config, or set DEEPSEEK_API_KEY env var.")
            sys.exit(1)
        if not sys.stdin.isatty():
            print("Error: DEEPSEEK_API_KEY not set. Use env var or run interactively to configure.")
            sys.exit(1)
        config = _first_run_wizard()

    api_key = None if args.no_auth else (config.api_key or secrets.token_urlsafe(32))

    app = create_app(config, api_key)

    host = config.host
    port = args.port or config.port

    print(f"deepseek2responses v0.1.0")
    if config.api_key:
        print(f"Proxy API key: {api_key}")
    else:
        print(f"Proxy API key: {api_key}")

    if args.no_auth:
        print(f"WARNING: auth disabled (--no-auth)")
    else:
        print(f"Use this key in your Codex/LLM client config")

    print(f"Bind:     http://{host}:{port}")
    print(f"Endpoint: http://127.0.0.1:{port}/v1/responses")
    print(f"Docs:     http://127.0.0.1:{port}/docs")

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
