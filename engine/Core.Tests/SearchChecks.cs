using System;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tpm.Setup.Core;

/// <summary>Actual small-track searches plus distinct physical-lap and no-lap cutoffs.</summary>
static class SearchChecks
{
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }

    internal static JsonObject Source()
    {
        var source = JsonNode.Parse(SavedCarChecks.Source)!.AsObject();
        source["version"] = 1; source["setupModel"] = "formula";
        source["activePolicies"] = JsonNode.Parse("""{"car":{"corner_speed_multiplier":1,"acceleration_multiplier":1,"braking_multiplier":1,"drag_multiplier":1}}""");
        source["weather"] = JsonNode.Parse("""{"temperature_c":25,"wetness_mm":0}""");
        source["sessionOptions"] = JsonNode.Parse("""{"wind_enabled":false}"""); source["dynamicsStaff"] = new JsonArray();
        source["track"] = JsonNode.Parse("""{"length_km":0.05,"micro_sectors":[{"type":"low","length_pct":50,"target_speed_kmh":80},{"type":"straight","length_pct":50,"target_speed_kmh":150}]}""");
        source["settings"] = JsonNode.Parse("""{"front_wing":10,"rear_wing":10,"front_pressure_psi":21,"rear_pressure_psi":21,"suspension_level":3}""");
        source["setupAxes"] = JsonNode.Parse("""[{"key":"front_wing","min":0,"max":20,"step":1,"scale":1,"coarse":3},{"key":"rear_wing","min":0,"max":20,"step":1,"scale":1,"coarse":3},{"key":"front_pressure_psi","min":20,"max":22,"step":0.1,"scale":10,"coarse":10},{"key":"rear_pressure_psi","min":20,"max":22,"step":0.1,"scale":10,"coarse":10},{"key":"suspension_level","min":1,"max":5,"step":1,"scale":1,"coarse":2}]""");
        source["tyres"] = JsonNode.Parse("""[{"name":"soft","lat_grip_base":1,"long_grip_base":1,"temp_window_c":[80,110],"wetness_states":[{"min_mm":0,"max_mm":5,"lat_mult":1,"long_mult":1}]}]""");
        var medium = source["tyres"]![0]!.DeepClone(); medium["name"] = "medium"; medium["lat_grip_base"] = .9;
        source["tyres"]!.AsArray().Add(medium);
        source["drivers"]![0]!["entry"] = 1;
        source["drivers"]![0]!["skills"] = JsonNode.Parse("""{"cornering":10,"braking":10}"""); source["drivers"]![0]!["preferences"]!["traction_preference"] = 50;
        source["activePolicies"]!["ers"] = JsonNode.Parse("""{"ers_mode":"spec","ers_enabled":true}""");
        source["definitions"]!["ers_development"] = new JsonObject();
        source["teamInputs"]!["tyre_contract"] = JsonNode.Parse("""{"type":"customer"}""");
        source["tyreSupplier"] = JsonNode.Parse("""{"lateral_grip":{"soft":50,"medium":50},"longitudinal_grip":{"soft":50,"medium":50},"temperature_tolerance":{"soft":50,"medium":50}}""");
        return source;
    }

    public static void Run()
    {
        var source = Source();
        var request = new JsonObject { ["source"] = source, ["payload"] = JsonNode.Parse("""{"seed":51,"trackId":"authored","search":{"seconds":15,"refine_laps":500,"stall_laps":100,"idle_batches":64,"cache_entries":101}}"""), ["mode"] = "search", ["names"] = new JsonArray("Example Driver") };
        using var job = new SearchJob(request.ToJsonString()); var clock = Stopwatch.StartNew();
        while (!job.PrepareStep()) Check(clock.Elapsed.TotalSeconds < 10, "Search preparation did not finish.");
        while (job.SearchStep()) Check(clock.Elapsed.TotalSeconds < 10, "Bounded authored search did not finish.");
        Check(job.Drivers[0].Cases.All(state => state.StopReason != null), "A completed search retained active cases.");
        using var snapshot = JsonDocument.Parse(SearchSnapshot.All(job));
        Check(snapshot.RootElement[0].GetProperty("rows")[0].GetProperty("score").GetDouble() > 90, "Authored setup search lost its good result.");
        Check(job.CacheEntries > 0, "Search did not retain reusable candidate results.");
        Check(job.Drivers[0].Cases.Select(state => state.Scorer).OfType<CompoundSearch>().All(scorer => scorer.CacheEntries <= 101), "Search ignored its configured cache bound.");

        var scenario = job.Drivers[0].Scenario; var limits = new SearchLimits(); var point = scenario.Space.Ticks(scenario.Initial);
        var soft = scenario.Evaluate(0, point); var mediumLap = scenario.Evaluate(1, point);
        Check(soft.Lap != mediumLap.Lap, "Shared setup effects must retain compound-specific grip and lap times.");
        // A long stream of pruned proposals must not retain every setup or change a revisited lap.
        for (int i = 0; i < 5000; i++) scenario.Ceiling(point.With(0, i % 21).With(1, i / 21 % 21).With(2, 200 + i / 441));
        Check(scenario.SetupCacheEntries < 5000, "Pruned setup effects grew without a bound.");
        Check(scenario.Evaluate(0, point).Lap == soft.Lap && scenario.Evaluate(1, point).Lap == mediumLap.Lap, "Reusing setup or motion buffers changed revisited laps.");
        var scorer = new CompoundSearch(scenario, 0, new(scenario.Initial, 90, 0), new());
        LapResult Result(double traction) => new LapResult { Compound = "soft", Settings = scenario.Initial, Balance = 65, Traction = traction, Lap = 90 }.Assess(65, 50, new(scenario.Initial, 90, 0));
        SearchCase Case() { var state = new SearchCase(scorer, Result(43), point, scenario.Space); state.Advance([], 0, limits, false); return state; }
        var stalled = Case(); stalled.Advance([], 100, limits, true);
        Check(stalled.StopReason == "stall" && stalled.Progress!.Laps == 100, "Stall cutoff must count physical laps.");
        var idle = Case(); for (int i = 0; i < 64; i++) idle.Advance([], 0, limits, true);
        Check(idle.StopReason == "idle" && idle.Progress!.Laps == 0, "Cached/pruned work needs a separate no-lap cutoff.");
        var refined = Case();
        for (int i = 1; i <= 6; i++) refined.Advance([new(point, Result(43 + i * .1))], i < 6 ? 99 : 5, limits, true);
        Check(refined.StopReason == "refinement" && refined.Progress!.Laps == 500 && refined.Progress.StaleLaps == 0, "Material gains reset stall, not the total refinement budget.");
        job.Dispose(); Check(job.CacheEntries == 0, "Disposed search retained candidate caches.");
        Console.WriteLine("Native search, physical-lap cutoffs and cache cleanup checks passed.");
    }
}
