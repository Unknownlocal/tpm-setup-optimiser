"""Build the complete static site in Vercel's Linux build container.

The SDK is a build dependency only. Browsers receive the reviewed static bundle,
including the compiled WebAssembly engine; Flask remains a local preview tool.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen

import build_release


def main():
    if sys.platform != "linux":
        raise SystemExit("This bootstrap is for Vercel/Linux. Use tools/build_release.py for local builds.")
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / "engine/global.json").read_text())["sdk"]["version"]
    sdk = root / ".vercel/dotnet"
    # Keep the build SDK outside .vercel/output so it cannot enter the deployment.
    with TemporaryDirectory(prefix="tpm-dotnet-") as temporary:
        installer = Path(temporary) / "dotnet-install.sh"
        with urlopen("https://dot.net/v1/dotnet-install.sh", timeout=60) as response:
            installer.write_bytes(response.read())
        subprocess.run(["bash", str(installer), "--version", version,
                        "--install-dir", str(sdk), "--no-path"], check=True)
    os.environ["DOTNET_ROOT"] = str(sdk)
    os.environ["PATH"] = str(sdk) + os.pathsep + os.environ["PATH"]
    os.environ["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1"
    os.environ["DOTNET_NOLOGO"] = "1"
    subprocess.run([str(sdk / "dotnet"), "workload", "install", "wasm-tools", "--skip-manifest-update"],
                   cwd=root / "engine", check=True)
    build_release.main()


if __name__ == "__main__":
    main()
