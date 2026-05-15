from __future__ import annotations

import argparse
import sys

import uvicorn
from fastapi import FastAPI

from deepseek2responses.config import Config, load_config
from deepseek2responses.routers.responses import router


def create_app(config: Config) -> FastAPI:
    app = FastAPI(
        title="deepseek2responses",
        description="Convert DeepSeek/Anthropic API to OpenAI Responses API",
        version="0.1.0",
    )
    app.state.config = config
    app.include_router(router)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="deepseek2responses proxy server")
    parser.add_argument("--config", "-c", type=str, default=None, help="Path to config file")
    parser.add_argument("--port", "-p", type=int, default=None, help="Server port (overrides config)")
    parser.add_argument("--version", "-v", action="store_true", help="Show version")
    args = parser.parse_args()

    if args.version:
        from deepseek2responses import __version__
        print(f"deepseek2responses v{__version__}")
        sys.exit(0)

    config = load_config(args.config)
    app = create_app(config)

    host = config.server.host
    port = args.port or config.server.port

    print(f"deepseek2responses v0.1.0")
    print(f"Config loaded")
    print(f"Provider: {config.default_provider} (default)")
    print(f"Listening on http://{host}:{port}")
    print(f"API docs: http://{host}:{port}/docs")

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
