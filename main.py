#!/usr/bin/env python3
"""Entry point for the NWS weather dashboard.

Subcommands:
    web              Start the web server (server-side mode by default)
    web --client     Client-only mode (serves static files, no background fetching)
"""

import argparse
import time
from pathlib import Path

from flask import Flask

from app.blueprint import create_blueprint

PROJECT_ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description="NWS Weather Dashboard")
    subparsers = parser.add_subparsers(dest="command")

    web_parser = subparsers.add_parser("web", help="Start the web server")
    web_parser.add_argument(
        "--client",
        action="store_true",
        help="Client-only mode (serves static files, no background fetching)",
    )
    web_parser.add_argument(
        "--host", default="0.0.0.0", help="Bind address",
    )
    web_parser.add_argument(
        "--port", type=int, default=8081, help="Port",
    )

    args = parser.parse_args()

    if args.command == "web":
        if args.client:
            app = Flask(__name__)
            app.register_blueprint(create_blueprint(), url_prefix="/")

            print(f"Serving NWS dashboard at http://{args.host}:{args.port}")
            app.run(host=args.host, port=args.port)
        else:
            from app.background import start_background_tasks
            from app.config import ENABLE_HRRR, NWS_INTERVAL_SECONDS

            app = Flask(__name__)
            app.register_blueprint(
                create_blueprint(
                    config={
                        "server_side": True,
                        "data_dir": str(PROJECT_ROOT / "server_side" / "data"),
                    }
                ),
                url_prefix="/",
            )

            # Ensure data directory exists
            (PROJECT_ROOT / "server_side" / "data").mkdir(
                parents=True, exist_ok=True
            )

            stop_event, threads = start_background_tasks()

            print("[Server] Waiting for initial NWS fetch...")
            time.sleep(2)

            print(f"[Server] Serving at http://{args.host}:{args.port}")
            print(f"[Server] NWS refresh: every {NWS_INTERVAL_SECONDS} seconds")
            print(f"[Server] HRRR enabled: {ENABLE_HRRR}")

            try:
                app.run(host=args.host, port=args.port)
            except KeyboardInterrupt:
                print("\n[Server] Shutting down...")
                stop_event.set()
                for t in threads:
                    t.join(timeout=2)
                print("[Server] Stopped")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
