"""Flask Blueprint for the NWS weather dashboard."""

from flask import Blueprint, send_from_directory
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # app/blueprint.py → app/ → project/

DEFAULT_CONFIG = {
    "server_side": False,
    "data_dir": str(PROJECT_ROOT / "server_side" / "data"),
}


def create_blueprint(name="nws", config=None):
    """Create and return the NWS Flask Blueprint.

    Args:
        name: Blueprint name (used for url_for namespacing).
        config: Optional dict overriding DEFAULT_CONFIG keys.
            - server_side (bool): If True, register /data/ route for pre-fetched data.
            - data_dir (Path|str): Directory containing locations.json for server-side mode.

    Returns:
        A Flask Blueprint that serves the NWS dashboard.
    """
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    bp = Blueprint(name, __name__)

    @bp.route("/")
    def index():
        return send_from_directory(PROJECT_ROOT, "index.html")

    @bp.route("/<path:filename>")
    def static_files(filename):
        return send_from_directory(PROJECT_ROOT, filename)

    if cfg["server_side"]:
        data_dir = Path(cfg["data_dir"])

        @bp.route("/data/<path:filename>")
        def data_files(filename):
            return send_from_directory(data_dir, filename)

    return bp
