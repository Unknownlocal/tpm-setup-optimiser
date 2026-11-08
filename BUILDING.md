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

Open http://127.0.0.1:5080. Drop the game folder, select the save's data
mod and a save, then check the circuit and conditions. **Find setups** searches;
**Grade entered setup** scores the entered settings. Copy/download stays local.
The mod must be inside that game folder; use its name or relative path.
The save list is filtered by the selected mod folder's identifier in `data_pack`.
When the scan finishes, the most recently modified matching save is selected
unless you have already chosen or cleared a save yourself.
Scanning runs locally in the background and can be stopped; selecting the mod
again finishes the scan using cached metadata. A manually chosen save must match
the mod too. Tyre checkboxes come from that mod's definitions, with all selected
initially. AVG_DRY is included when soft, medium and hard are selected.
Advanced session settings let you change fuel load, driving pace and engine mode
for every driver. Defaults remain 15 kg, push and medium. Both setup searches and
their reference laps use the selected conditions. Fuel stays constant during each
projected lap; fuel burn, wear and failures are not simulated.
Advanced grading settings let you set the pace percentage; driver preference
uses the remaining share. The default is 85% pace and 15% preference. This affects
grading and setup search, including AVG_DRY. Custom weights change optimiser
grades; they do not change the predicted lap time for a fixed setup.

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

Vercel Git deployments run `python3 tools/build_vercel.py`. This installs the
.NET SDK version from `engine/global.json` and its WebAssembly build tools in
the build container, then runs the same static bundle build as above. The
`framework: null` setting overrides Flask detection. No Python function is
deployed. A failed engine build fails the deployment rather than publishing a
page without its engine. SDK files stay outside the deployed output.

The GitHub build workflow checks local selection behaviour and calculations,
then builds this bundle on pull requests or manual runs, using .NET SDK 10.0.403.
It does not deploy. Extract its
`vercel-output` artifact into `.vercel/output` to inspect that build.
The small selection checks can also run locally with Node 24:
`node --test tests/local-selection.test.mjs`. Tests are excluded from the bundle.

To deploy an already built bundle instead, link the intended Vercel project and use
`vercel deploy --prebuilt` from this folder. Review the project/environment first;
`--prod` selects production. The [Vercel Build Output API](https://vercel.com/docs/build-output-api)
serves the prepared bundle without a Python function. Flask remains a local
preview server. Hosted routing and browser checks should be repeated on that
deployment before calling it a release.
