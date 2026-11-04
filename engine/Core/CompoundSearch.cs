using System.Collections.Generic;
using System.Linq;

namespace Tpm.Setup.Core;

/// <summary>Only this fixed driver's fitted car, compound and conditions may use this cache.</summary>
public sealed class CompoundSearch : CandidateScorer
{
    sealed record Entry(double Ceiling, LapResult? Row = null);
    readonly Dictionary<SetupPoint, Entry> cache = [];
    readonly DriverScenario scenario;
    readonly SearchStats stats;
    readonly int compound;
    public ReferenceResult Reference { get; }
    public string Name => scenario.Compounds[compound];
    public LapResult? BestKnown { get; private set; }
    public int CacheEntries => cache.Count;

    public CompoundSearch(DriverScenario scenario, int compound, ReferenceResult reference, SearchStats stats)
    { this.scenario = scenario; this.compound = compound; Reference = reference; this.stats = stats; }

    Entry Info(SetupPoint point)
    {
        if (!cache.TryGetValue(point, out var entry)) cache[point] = entry = new(scenario.Ceiling(point));
        return entry;
    }
    public double UpperBound(SetupPoint point) { var info = Info(point); return info.Row?.Score ?? info.Ceiling; }

    public IEnumerable<int> Evaluate(IEnumerable<SetupPoint> points, double incumbent, List<CandidateRow> found)
    {
        var pending = new List<SetupPoint>();
        foreach (var point in points.Distinct())
        {
            var info = Info(point);
            if (info.Row != null) { stats.Cached++; found.Add(new(point, info.Row)); }
            else if (info.Ceiling + 1e-10 < incumbent) stats.Pruned++;
            else pending.Add(point);
        }
        for (int start = 0; start < pending.Count; start += 16)
        {
            foreach (var point in pending.Skip(start).Take(16))
            {
                var row = scenario.Evaluate(compound, scenario.Space.Settings(point)).Assess(scenario.BalancePreference, scenario.TractionPreference, Reference);
                cache[point] = new(Info(point).Ceiling, row); found.Add(new(point, row)); stats.Evaluated++;
                if (BestKnown == null || row.Score > BestKnown.Score) BestKnown = row;
            }
            yield return 0;
        }
    }
    public void Clear() { cache.Clear(); BestKnown = null; }
}
