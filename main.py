#!/usr/bin/env python3
"""Entry point for the NWS weather dashboard.

Usage:
    python main.py              # Server-side mode (background NWS fetching)
    python main.py --client     # Client-only mode (serves static files)
"""

import argparse
import time
from pathlib import Path

from flask import Flask

from app.blueprint import create_blueprint

PROJECT_ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description="NWS Weather Dashboard")
    parser.add_argument(
        "--client",
        action="store_true",
        help="Client-only mode (serves static files, no background fetching)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Port to serve on (default: 5173)",
    )
    args = parser.parse_args()

    if args.client:
        port = args.port or 5173

        app = Flask(__name__)
        app.register_blueprint(create_blueprint(), url_prefix="/")

        print(f"Serving NWS dashboard at http://localhost:{port}")
        app.run(host="0.0.0.0", port=port)
    else:
        from app.background import start_background_tasks
        from app.config import ENABLE_HRRR, NWS_INTERVAL_SECONDS, SERVER_PORT

        port = args.port or SERVER_PORT

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

        print(f"[Server] Serving at http://localhost:{port}")
        print(f"[Server] NWS refresh: every {NWS_INTERVAL_SECONDS} seconds")
        print(f"[Server] HRRR enabled: {ENABLE_HRRR}")

        try:
            app.run(host="0.0.0.0", port=port)
        except KeyboardInterrupt:
            print("\n[Server] Shutting down...")
            stop_event.set()
            for t in threads:
                t.join(timeout=2)
            print("[Server] Stopped")


if __name__ == "__main__":
    main()
