using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tpm.Setup.Core;

/// <summary>Dry-average and individual searches must reuse bounded, compound-specific scores.</summary>
static class CacheChecks
{
    public static void Run()
    {
        var source = SearchChecks.Source();
        var hard = source["tyres"]![0]!.DeepClone(); hard["name"] = "hard"; hard["lat_grip_base"] = .8; source["tyres"]!.AsArray().Add(hard);
        foreach (string axis in new[] { "lateral_grip", "longitudinal_grip", "temperature_tolerance" }) source["tyreSupplier"]![axis]!["hard"] = 50;
        using var job = new SearchJob(new JsonObject { ["source"] = source, ["payload"] = JsonNode.Parse("""{"seed":51}"""), ["names"] = new JsonArray("Example Driver") }.ToJsonString());
        var scenario = job.Drivers[0].Scenario; var stats = new SearchStats();
        int[] limits = [100, 101, SearchLimits.DefaultCacheEntries], peaks = new int[3];
        var scorers = Enumerable.Range(0, 3).Select(i => new CompoundSearch(scenario, i, new(scenario.Initial, 90, 0), stats, limits[i])).ToArray();
        var average = new AverageSearch(scorers, stats); var initial = scenario.Space.Ticks(scenario.Initial);
        var points = Enumerable.Range(0, 8193).Select(i => initial.With(0, i % 21).With(1, i / 21 % 21).With(2, 200 + i / 441)).ToArray();
        var first = new List<CandidateRow>(); foreach (int slice in average.Evaluate([points[0]], -1, first)) { }
        var best = first[0].Row.Components!.ToArray();
        // Observe each real setup so a batch cannot skip the full-cache point before eviction.
        foreach (var point in points.Skip(1))
        {
            var found = new List<CandidateRow>(); foreach (int slice in average.Evaluate([point], -1, found)) { }
            if (found.Count != 1) throw new Exception("Scored laps lost average components.");
            for (int i = 0; i < 3; i++)
            {
                peaks[i] = Math.Max(peaks[i], scorers[i].CacheEntries);
                if (peaks[i] > limits[i]) throw new Exception("Scored laps exceeded their configured per-compound bound.");
            }
            foreach (var row in found) for (int i = 0; i < 3; i++) if (row.Row.Components![i].Score > best[i].Score) best[i] = row.Row.Components[i];
        }
        for (int i = 0; i < 3; i++)
        {
            if (peaks[i] != limits[i]) throw new Exception("Cache did not use its full even/odd capacity.");
            if (!ReferenceEquals(scorers[i].BestKnown, best[i])) throw new Exception("Eviction discarded a compound's best known result.");
        }
        int before = stats.Evaluated;
        // A recent AVG_DRY component remains available to its individual scorer.
        for (int i = 0; i < 3; i++)
        {
            var found = new List<CandidateRow>(); foreach (int slice in scorers[i].Evaluate([points[^2]], -1, found)) { }
            if (found.Count != 1 || found[0].Row.Compound != scenario.Compounds[i] || scorers[i].UpperBound(points[^2]) != found[0].Row.Score) throw new Exception("Individual search lost its cached dry-average component.");
        }
        // Exercise the upper endpoint with an actual lap and its own counters.
        using (var raw = JsonDocument.Parse("""{"cache_entries":100000}"""))
        {
            var maximum = new CompoundSearch(scenario, 0, new(scenario.Initial, 90, 0), new(), SearchLimits.Read(raw.RootElement).CacheEntries);
            var found = new List<CandidateRow>(); foreach (int slice in maximum.Evaluate([points[0]], -1, found)) { }
            if (found.Count != 1 || maximum.CacheEntries != 1) throw new Exception("Maximum cache bound could not score a setup.");
        }
        foreach (string value in new[] { "99", "100001", "100.5" })
        {
            using var raw = JsonDocument.Parse($"{{\"cache_entries\":{value}}}");
            try { SearchLimits.Read(raw.RootElement); throw new Exception("Invalid cache bound was accepted."); }
            catch (ArgumentException) { }
        }
        if (stats.Evaluated != before) throw new Exception("Recent average components were recalculated.");
        var revisited = new List<CandidateRow>(); foreach (int slice in average.Evaluate([points[0]], -1, revisited)) { }
        if (stats.Evaluated != before + 3) throw new Exception("Old scored laps were not evicted.");
        for (int i = 0; i < 3; i++)
        {
            var old = first[0].Row.Components![i]; var current = revisited[0].Row.Components![i];
            if (old.Score != current.Score || old.Lap != current.Lap) throw new Exception("Recalculation changed an evicted compound score or lap.");
            scorers[i].Clear();
            if (scorers[i].CacheEntries != 0 || scorers[i].BestKnown != null) throw new Exception("Compound cleanup retained scores.");
        }
        Console.WriteLine("Bounded compound caches, dry-average reuse and eviction checks passed.");
    }
}
