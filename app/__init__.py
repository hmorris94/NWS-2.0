"""NWS Weather Dashboard — Flask application."""

from flask import Flask
from .blueprint import create_blueprint


def create_app(config=None):
    app = Flask(__name__)
    bp_config = {"server_side": True, **(config or {})}
    app.register_blueprint(create_blueprint(config=bp_config), url_prefix="/")
    return app