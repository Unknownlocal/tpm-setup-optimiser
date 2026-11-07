"""Serve fixed application assets; local file processing stays in the browser."""
import json
from pathlib import Path

from flask import Flask

# Vercel serves public files directly. Reuse its headers during local Flask runs.
HEADERS = json.loads(Path(__file__).with_name("vercel.json").read_text())["headers"][0]["headers"]


def create_app(static_folder="public"):
    """Use the same local server for source assets or a prepared release bundle."""
    application = Flask(__name__, static_folder=static_folder, static_url_path="")

    @application.after_request
    def secure_response(response):
        for header in HEADERS:
            response.headers[header["key"]] = header["value"]
        response.headers["Cache-Control"] = "no-cache"
        return response

    @application.get("/")
    def read_root():
        return application.send_static_file("index.html")

    return application


app = create_app()
