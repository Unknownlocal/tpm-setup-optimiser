using System.Collections.Generic;
using System.Linq;

namespace Tpm.Setup.Core;

/// <summary>Only this fixed driver's fitted car, compound and conditions may use this cache.</summary>
public sealed class CompoundSearch : CandidateScorer
{
    readonly Dictionary<SetupPoint, LapResult> cache = [];
    readonly DriverScenario scenario;
    readonly SearchStats stats;
    readonly int compound;
    public ReferenceResult Reference { get; }
    public string Name => scenario.Compounds[compound];
    public LapResult? BestKnown { get; private set; }
    public int CacheEntries => cache.Count;

    public CompoundSearch(DriverScenario scenario, int compound, ReferenceResult reference, SearchStats stats)
    { this.scenario = scenario; this.compound = compound; Reference = reference; this.stats = stats; }

    public double UpperBound(SetupPoint point) => cache.TryGetValue(point, out var row) ? row.Score : scenario.Ceiling(point);

    public IEnumerable<int> Evaluate(IEnumerable<SetupPoint> points, double incumbent, List<CandidateRow> found)
    {
        var pending = new List<SetupPoint>();
        foreach (var point in points.Distinct())
        {
            if (cache.TryGetValue(point, out var row)) { stats.Cached++; found.Add(new(point, row)); }
            else if (scenario.Ceiling(point) + 1e-10 < incumbent) stats.Pruned++;
            else pending.Add(point);
        }
        for (int start = 0; start < pending.Count; start += 16)
        {
            foreach (var point in pending.Skip(start).Take(16))
            {
                var row = scenario.Evaluate(compound, point).Assess(scenario.BalancePreference, scenario.TractionPreference, Reference, scenario.Weights);
                cache[point] = row; found.Add(new(point, row)); stats.Evaluated++;
                if (BestKnown == null || row.Score > BestKnown.Score) BestKnown = row;
            }
            yield return 0;
        }
    }
    public void Clear() { cache.Clear(); BestKnown = null; }
}
