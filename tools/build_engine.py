"""Build the .NET browser engine from any working directory.

Requires the .NET 10 SDK and `dotnet workload install wasm-tools`.
Run `python tools/build_engine.py` from the project folder. Published files go
to build/engine, including the upstream runtime licence notices. Game files
are never read by this build.
"""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
OUTPUT = ROOT / "build/engine"


def main():
    version = subprocess.check_output(["dotnet", "--version"], cwd=ENGINE, text=True).strip()
    if not version.startswith("10."):
        raise SystemExit("The engine requires the .NET 10 SDK.")
    subprocess.run(["dotnet", "publish", "Tpm.Setup.Engine.csproj", "-c", "Release"], cwd=ENGINE, check=True)
    framework = ENGINE / "bin/Release/net10.0/publish/wwwroot/_framework"
    if not framework.is_dir():
        raise SystemExit("The published .NET runtime folder was not produced.")
    destination = OUTPUT / "_framework"
    destination.mkdir(parents=True, exist_ok=True)
    # Fingerprinted filenames change on rebuild. Drop only obsolete immediate files.
    for old in destination.iterdir():
        if old.is_file() and not (framework / old.name).is_file():
            old.unlink()
    shutil.copytree(framework, destination, dirs_exist_ok=True)
    shutil.copytree(ROOT / "notices/dotnet", OUTPUT / "notices", dirs_exist_ok=True)
    print(f"Built .NET {version} browser engine: {OUTPUT}")


if __name__ == "__main__":
    main()
