"""Build a browser-only Vercel bundle without linking or publishing a project.

Run with the default Python from any directory. Requires the same .NET 10 SDK
and wasm-tools workload as build_engine.py. Only reviewed app files and the
published engine's declared resources enter .vercel/output/static.
"""
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile

import build_engine

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUTPUT = ROOT / ".vercel/output"
MANIFEST = ROOT / "build/release-manifest.json"
APP_FILES = (
    "index.html", "favicon.ico", "assets/style.css",
    *(f"assets/{name}.js" for name in (
        "app", "compounds", "compound-selection", "save-catalogue", "debug-log", "event-resolution", "folder-access", "input-panel",
        "input-preparation", "lap-contract", "lap-physics", "metadata-worker",
        "mod-resolver", "python-literals", "result-export", "result-format",
        "result-panel", "search-pool", "search-settings", "search-worker",
        "session-conditions", "setup-model",
    )),
)
NOTICES = ("LICENSE.TXT", "THIRD-PARTY-NOTICES.TXT")


def checked_file(path):
    """Reject links and paths outside this checkout before copying or hashing."""
    if path.resolve() != path.absolute() or not path.resolve().is_relative_to(ROOT) or not path.is_file():
        raise ValueError(f"Missing file or linked path is not allowed: {path}")
    return path


def checked_location(path):
    if path.resolve() != path.absolute() or not path.resolve().is_relative_to(ROOT):
        raise ValueError(f"Generated paths must remain inside this checkout: {path}")
    return path


def digest(path):
    return hashlib.sha256(checked_file(path).read_bytes()).hexdigest()


def source_hashes():
    files = [PUBLIC / name for name in APP_FILES]
    files += [ROOT / "notices/dotnet" / name for name in NOTICES]
    files += [ROOT / name for name in ("vercel.json", "engine/global.json", "tools/build_engine.py", "tools/build_release.py")]
    for folder in ("Core", "Browser"):
        files += [path for path in (ROOT / "engine" / folder).rglob("*")
                  if path.suffix in (".cs", ".csproj") and not {"bin", "obj"}.intersection(path.parts)]
    return {path.relative_to(ROOT).as_posix(): digest(path) for path in sorted(files)}


def engine_files():
    """Follow the SDK's literal resource manifest, never execute its loader."""
    framework = PUBLIC / "engine/_framework"
    loader = checked_file(framework / "dotnet.js")
    try:
        config = json.loads(loader.read_text(encoding="utf-8").split("/*json-start*/", 1)[1].split("/*json-end*/", 1)[0])
    except (IndexError, ValueError) as error:
        raise ValueError("The published engine has an unsupported resource manifest.") from error
    if config["mainAssemblyName"] not in ("Tpm.Setup.Browser", "Tpm.Setup.Browser.dll") or config.get("debugLevel") != 0:
        raise ValueError("The release needs the optimised browser engine without debug resources.")
    files = {"engine/_framework/dotnet.js": loader}
    for category, resources in config["resources"].items():
        if category == "hash":
            continue
        if not isinstance(resources, list):
            raise ValueError(f"Unsupported engine resource group: {category}")
        for resource in resources:
            name = resource["name"]
            if not re.fullmatch(r"(?:dotnet\.(?:native|runtime)|System\.[A-Za-z0-9_.]+|Tpm\.Setup\.(?:Core|Browser))\.[a-z0-9]+\.(?:js|wasm)", name):
                raise ValueError(f"Unsupported engine resource: {name}")
            path = checked_file(framework / name)
            if "hash" in resource:
                actual = "sha256-" + base64.b64encode(bytes.fromhex(digest(path))).decode("ascii")
                if resource["hash"] != actual:
                    raise ValueError(f"Engine resource hash mismatch: {name}")
            files[f"engine/_framework/{name}"] = path
    return files


def check_references(files):
    """Fail if a new local module or HTML asset was omitted from the release list."""
    for name in APP_FILES:
        source = PUBLIC / name
        text = source.read_text(encoding="utf-8") if source.suffix in (".js", ".html") else ""
        pattern = r'''(?:from\s*|import\s*\(?\s*|new\s+Worker\s*\(\s*)["']([^"']+)["']''' if source.suffix == ".js" else r'''(?:src|href)=["']([^"']+)["']'''
        for reference in re.findall(pattern, text):
            target = PUBLIC / reference.lstrip("/") if reference.startswith("/") else source.parent / reference
            if not target.resolve().is_relative_to(PUBLIC) or target.resolve().relative_to(PUBLIC).as_posix() not in files:
                raise ValueError(f"Unlisted browser asset in {name}: {reference}")


def package_release(sources):
    """Assemble a clean staging folder before replacing the previous generated output."""
    files = {name: checked_file(PUBLIC / name) for name in APP_FILES}
    files.update(engine_files())
    files.update({f"engine/notices/{name}": checked_file(ROOT / "notices/dotnet" / name) for name in NOTICES})
    check_references(files)
    headers = {item["key"]: item["value"] for item in json.loads((ROOT / "vercel.json").read_text())["headers"][0]["headers"]}
    headers["Cache-Control"] = "no-cache"
    config = {"version": 3, "routes": [
        {"src": "/(.*)", "headers": headers, "continue": True},
        {"src": "/", "dest": "/index.html"},
        {"handle": "filesystem"},
    ], "overrides": {name: {"contentType": "application/wasm"} for name in files if name.endswith(".wasm")}}
    # These are fixed generated paths, checked before any recursive removal.
    checked_location(OUTPUT)
    checked_location(MANIFEST)
    checked_location(ROOT / "build").mkdir(exist_ok=True)
    checked_location(OUTPUT.parent).mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="release-", dir=ROOT / "build") as temporary:
        stage = Path(temporary) / "output"
        for name, source in files.items():
            destination = stage / "static" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        (stage / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        assets = {path.relative_to(stage).as_posix(): digest(path) for path in sorted(stage.rglob("*")) if path.is_file()}
        if sources != source_hashes():
            raise ValueError("Source files changed during the build. Build again before publishing.")
        if OUTPUT.exists():
            shutil.rmtree(OUTPUT)
        stage.rename(OUTPUT)
    MANIFEST.write_text(json.dumps({"sources": sources, "files": assets}, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(files)} static files: {OUTPUT}")
    print(f"Local verification manifest: {MANIFEST}")


def main():
    sources = source_hashes()
    build_engine.main()
    package_release(sources)


if __name__ == "__main__":
    main()
