# Build and check the browser bundle

The interface and calculation code are still under development. Building a bundle
does not publish it.

Install Python 3.9 or later, the [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0),
then run these commands from this folder:

```powershell
dotnet workload install wasm-tools
python tools/build_release.py
```

The build produces `.vercel/output/static` and a Vercel routing configuration.
It includes only the listed browser files, engine resources and runtime notices.
Tests, source projects and selected game files are excluded. File hashes are
recorded locally in `build/release-manifest.json`.

To inspect the built files locally:

```powershell
python -m pip install "flask>=3.1,<4"
python -m flask --app "main:create_app('.vercel/output/static')" run --port 5080
```

Open http://127.0.0.1:5080. Choose or drop the game folder, select the save's data
mod and a save, then check the circuit and conditions. **Find setups** searches;
**Grade entered setup** scores the entered settings. Copy/download stays local.
Firefox uses folder drops; browsers with a directory picker can also use it.

Saves must use schema version 3, Formula entries, the standard car profile and
fitted chassis baseline snapshots. The data mod must match the save. The build
contains no game data or original game binaries. Lap estimates use the session
defaults described in the interface and can differ from the game's setup panel.
Saved tyre-supplier ratings and contract grip bonuses are applied. ERS follows the
active regulation: fitted statistics for open development, the game's standard
unit for spec rules, or no assistance when banned. The selected mod must include
`ers_development.json`; open ERS needs a fitted unit with its saved statistics.
Each projected lap starts charged. Battery depletion across laps and failures
are not simulated.

The GitHub build workflow checks the core and produces the same output on pull
requests or manual runs, using .NET SDK 10.0.403. It does not deploy. Extract its
`vercel-output` artifact into `.vercel/output` to inspect that build.

When a deployment is wanted, link the intended Vercel project and use
`vercel deploy --prebuilt` from this folder. Review the project/environment first;
`--prod` selects production. The [Vercel Build Output API](https://vercel.com/docs/build-output-api)
serves the prepared bundle without a Python function. Flask remains a local
preview server. Hosted routing and browser checks should be repeated on that
deployment before calling it a release.
