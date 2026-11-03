"""Serve fixed application assets; local file processing stays in the browser."""
import json
from pathlib import Path

from flask import Flask

app = Flask(__name__, static_folder="public", static_url_path="")
# Vercel serves public files directly. Reuse its headers during local Flask runs.
HEADERS = json.loads(Path(__file__).with_name("vercel.json").read_text())["headers"][0]["headers"]


@app.after_request
def secure_response(response):
    for header in HEADERS:
        response.headers[header["key"]] = header["value"]
    return response


@app.get("/")
def read_root():
    return app.send_static_file("index.html")
