using System;
using System.Collections.Generic;
using System.Linq;

namespace Tpm.Setup.Core;

/// <summary>Only this fixed driver's fitted car, compound and conditions may use this cache.</summary>
public sealed class CompoundSearch : CandidateScorer
{
    // Two generations bound retained laps without a per-entry eviction list.
    // Rotation drops the older half; best results outlive both generations.
    readonly int cacheLimit;
    int generationSize;
    Dictionary<SetupPoint, LapResult> cache = [], previous = [];
    readonly DriverScenario scenario;
    readonly SearchStats stats;
    readonly int compound;
    public ReferenceResult Reference { get; }
    public string Name => scenario.Compounds[compound];
    public LapResult? BestKnown { get; private set; }
    public int CacheEntries => cache.Count + previous.Count;

    public CompoundSearch(DriverScenario scenario, int compound, ReferenceResult reference, SearchStats stats, int cacheEntries = SearchLimits.DefaultCacheEntries)
    {
        if (cacheEntries is < 100 or > 100000) throw new ArgumentOutOfRangeException(nameof(cacheEntries));
        cacheLimit = cacheEntries; generationSize = (cacheEntries + 1) / 2;
        this.scenario = scenario; this.compound = compound; Reference = reference; this.stats = stats;
    }

    bool TryCached(SetupPoint point, out LapResult row) => cache.TryGetValue(point, out row!) || previous.TryGetValue(point, out row!);

    public double UpperBound(SetupPoint point) => TryCached(point, out var row) ? row.Score : scenario.Ceiling(point);

    public IEnumerable<int> Evaluate(IEnumerable<SetupPoint> points, double incumbent, List<CandidateRow> found)
    {
        var pending = new List<SetupPoint>();
        foreach (var point in points.Distinct())
        {
            if (TryCached(point, out var row)) { stats.Cached++; found.Add(new(point, row)); }
            else if (scenario.Ceiling(point) + 1e-10 < incumbent) stats.Pruned++;
            else pending.Add(point);
        }
        for (int start = 0; start < pending.Count; start += 16)
        {
            foreach (var point in pending.Skip(start).Take(16))
            {
                var row = scenario.Evaluate(compound, point).Assess(scenario.BalancePreference, scenario.TractionPreference, Reference, scenario.Weights);
                if (cache.Count == generationSize)
                {
                    (cache, previous) = (previous, cache); cache.Clear();
                    // Alternate the two half sizes so an odd limit is honoured exactly.
                    generationSize = cacheLimit - generationSize;
                }
                cache[point] = row; found.Add(new(point, row)); stats.Evaluated++;
                if (BestKnown == null || row.Score > BestKnown.Score) BestKnown = row;
            }
            yield return 0;
        }
    }
    public void Clear() { cache.Clear(); previous.Clear(); BestKnown = null; }
}
