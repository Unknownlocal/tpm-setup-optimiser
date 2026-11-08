# TPM Setup Optimiser

[MIT licence](LICENSE) · [Attribution and third-party licences](ATTRIBUTION.md)

[![Deploy your own version with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FUnknownlocal%2Ftpm-setup-optimiser)
[![Vercel deployment status](https://img.shields.io/github/checks-status/Unknownlocal/tpm-setup-optimiser/main?label=Vercel&logo=vercel)](https://github.com/Unknownlocal/tpm-setup-optimiser/commits/main)

## Use, run and deploy

A browser tool for finding and grading setups in **Team Principal: A Racing Manager**.
Supports Formula saves with standard car rules. Game files and calculations stay
in your browser; nothing you select is uploaded.

Open the [live app](https://tpm-setup-optimiser.vercel.app/), drag your game folder
from your file manager, then select its data mod and a save. Check the circuit,
conditions and tyre compounds, then choose **Find setups** or **Grade entered setup**.

The deploy button creates your own Vercel copy. The repository configuration runs
tests and builds the .NET browser engine before publishing static files. No game
installation or data is needed for deployment, and game files are not bundled or
redistributed with this repository.

For local development, install Python 3.9+ and the .NET 10 SDK version selected in
[engine/global.json](engine/global.json). From the repository folder, run:

```powershell
dotnet workload install wasm-tools
python -m pip install "flask>=3.1,<4"
python tools/build_release.py
python -m flask --app "main:create_app('.vercel/output/static')" run --port 5080
```

Open http://127.0.0.1:5080. See [BUILDING.md](BUILDING.md) for checks and packaging.

## Architecture

- **Browser interface** (`public/`): reads selected files, resolves the calendar
  and displays results. A background worker reads file details.
- **Calculation engine** (`engine/Core`, `engine/Browser`): C# compiled to .NET 10
  WebAssembly to run in the browser. Workers calculate reference laps, grades and
  setup searches with time and lap limits.
- **Hosting** (`tools/build_release.py`, `vercel.json`): packages the static site
  and engine. Vercel serves these files; Flask serves them for local development.

## Calculation engine development

The calculator in `engine/Core` is a reimplementation of the game's calculations
in C#. Development included read-only inspection of the installed game's Python
bytecode, including its fallback lap solver. This was not a clean-room process:
the implementation was informed by the inspected game logic.

Setup finding uses **stochastic local search**. It starts from reference setups,
improves individual settings (coordinate hill climbing), and explores random
alternatives. Cached scores avoid repeated calculations; score-bound pruning
skips candidates whose best possible score falls below the current best. Time,
refinement and stall limits bound the search. Results are the best found within
those limits, without a guarantee of the global optimum.

Lap times, reference setups and grades were compared with the unchanged game
using selected saves, circuits, tyre compounds and weather conditions. These
checks support the tested Formula scenarios; they do not prove complete
equivalence or compatibility with future game updates. Session assumptions and
time-limited searches can also produce different results from a live session.

The web app does not modify or replace the game's engine or compiled kernels,
and its bundle contains no original game binaries, bytecode or data. The optimiser's
calculation module is compiled from this repository's C# code. Selecting a game folder
does not let the browser execute the game's native `.pyd` kernels; the app uses
the reimplementation instead.

The project's MIT licence covers only material the project is entitled to license;
it does not relicense the game or settle rights in game-derived material.
See [ATTRIBUTION.md](ATTRIBUTION.md).
