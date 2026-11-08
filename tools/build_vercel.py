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
    # Fail before downloading build tools if local file/compound behaviour breaks.
    subprocess.run(["node", "--test", "tests/local-selection.test.mjs"], cwd=root, check=True)
    version = json.loads((root / "engine/global.json").read_text())["sdk"]["version"]
    # Cached workloads can retain installation records without their compiler files.
    # A fresh temporary SDK avoids that cache and is removed after the build.
    with TemporaryDirectory(prefix="tpm-dotnet-") as temporary:
        sdk = Path(temporary) / "sdk"
        installer = Path(temporary) / "dotnet-install.sh"
        with urlopen("https://dot.net/v1/dotnet-install.sh", timeout=60) as response:
            installer.write_bytes(response.read())
        subprocess.run(["bash", str(installer), "--version", version,
                        "--install-dir", str(sdk), "--no-path"], check=True)
        os.environ["DOTNET_ROOT"] = str(sdk)
        os.environ["PATH"] = str(sdk) + os.pathsep + os.environ["PATH"]
        os.environ["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1"
        os.environ["DOTNET_NOLOGO"] = "1"
        # Test the calculations before installing the larger WebAssembly workload.
        subprocess.run([str(sdk / "dotnet"), "run", "--project", "engine/Core.Tests/Tpm.Setup.Core.Tests.csproj",
                        "-c", "Release"], cwd=root, check=True)
        subprocess.run([str(sdk / "dotnet"), "workload", "install", "wasm-tools", "--skip-manifest-update"],
                       cwd=root / "engine", check=True)
        build_release.main()


if __name__ == "__main__":
    main()
