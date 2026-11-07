using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tpm.Setup.Core;

/// <summary>Custom objectives must reach entered grades, cached search rows and pruning bounds.</summary>
static class WeightChecks
{
    static void Near(double actual, double expected)
    { if (!double.IsFinite(actual) || Math.Abs(actual - expected) > 1e-9) throw new Exception($"Grading weights: {actual} != {expected}"); }

    public static void Run()
    {
        var source = SearchChecks.Source();
        SearchJob Job(string mode) => new(new JsonObject { ["source"] = source.DeepClone(), ["payload"] = JsonNode.Parse("""{"seed":51}"""), ["mode"] = mode, ["names"] = new JsonArray("Example Driver") }.ToJsonString());
        // A perfect pace score with imperfect preference must not be pruned by the old 85/15 ceiling.
        source["pace_weight_pct"] = 100;
        using (var job = Job("search"))
        {
            var scenario = job.Drivers[0].Scenario; var point = scenario.Space.Ticks(scenario.Initial);
            var stats = new SearchStats(); var scorer = new CompoundSearch(scenario, 0, new(scenario.Initial, 1000, 0), stats);
            var rows = new List<CandidateRow>(); foreach (int slice in scorer.Evaluate([point], 99.99, rows)) { }
            if (rows.Count != 1 || stats.Pruned != 0) throw new Exception("Pace-only search pruned a winning candidate.");
            Near(rows[0].Row.Score, 100); Near(scenario.Ceiling(point), 100);
            if (rows[0].Row.Preference >= 99) throw new Exception("The pruning fixture must retain imperfect preference.");
            rows.Clear(); foreach (int slice in scorer.Evaluate([point], 99.99, rows)) { }
            Near(rows[0].Row.Score, 100); Near(stats.Cached, 1);
        }
        source["pace_weight_pct"] = 0;
        using (var job = Job("search"))
        {
            var scenario = job.Drivers[0].Scenario; var point = scenario.Space.Ticks(scenario.Initial);
            var stats = new SearchStats(); var scorer = new CompoundSearch(scenario, 0, new(scenario.Initial, 1000, 0), stats);
            var rows = new List<CandidateRow>(); foreach (int slice in scorer.Evaluate([point], -1, rows)) { }
            Near(rows[0].Row.Score, rows[0].Row.Preference); Near(scenario.Ceiling(point), rows[0].Row.Score);
            // An unseen point above its preference-only ceiling needs no physical lap.
            var other = point.With(0, point[0] + 1); rows.Clear();
            foreach (int slice in scorer.Evaluate([other], scenario.Ceiling(other) + .1, rows)) { }
            if (rows.Count != 0 || stats.Pruned != 1 || stats.Evaluated != 1) throw new Exception("Preference-only pruning ignored its weighted ceiling.");
        }

        // Exercise the full grading/snapshot path and three genuinely different compound laps.
        var hard = source["tyres"]![0]!.DeepClone(); hard["name"] = "hard"; hard["lat_grip_base"] = .8; source["tyres"]!.AsArray().Add(hard);
        foreach (string axis in new[] { "lateral_grip", "longitudinal_grip", "temperature_tolerance" }) source["tyreSupplier"]![axis]!["hard"] = 50;
        source["pace_weight_pct"] = 37.5;
        using (var job = Job("grade"))
        {
            while (!job.PrepareStep()) { }
            using var snapshot = JsonDocument.Parse(SearchSnapshot.All(job)); var rows = snapshot.RootElement[0].GetProperty("rows").EnumerateArray().ToArray();
            double sum = 0;
            foreach (var row in rows.Skip(1))
            {
                double fit = row.GetProperty("preference_score").GetDouble(), pace = row.GetProperty("pace_score").GetDouble();
                Near(row.GetProperty("score").GetDouble(), .375 * pace + .625 * fit);
                Near(row.GetProperty("maximum_score").GetDouble(), 37.5 + .625 * fit); sum += row.GetProperty("score").GetDouble();
            }
            Near(rows[0].GetProperty("score").GetDouble(), sum / 3);
            if (rows[0].GetProperty("compound").GetString() != "avg_dry" || rows.Length != 4) throw new Exception("Weighted dry average lost its components.");
        }
        foreach (JsonNode invalid in new JsonNode[] { JsonValue.Create(-.1), JsonValue.Create(100.1), null })
        {
            source["pace_weight_pct"] = invalid;
            try { using var job = Job("grade"); throw new Exception("Invalid pace weight was accepted."); }
            catch (ArgumentException) { }
        }
        Console.WriteLine("Custom grading, weighted pruning and dry-average checks passed.");
    }
}
