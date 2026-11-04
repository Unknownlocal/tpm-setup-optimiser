using System.Collections.Generic;
using System.Linq;

namespace Tpm.Setup.Core;

/// <summary>A shared dry setting is scored against all three independently prepared references.</summary>
public sealed class AverageSearch : CandidateScorer
{
    readonly CompoundSearch[] scorers;
    readonly SearchStats stats;
    public LapResult? BestKnown => null;

    public AverageSearch(CompoundSearch[] scorers, SearchStats stats) { this.scorers = scorers; this.stats = stats; }
    public IEnumerable<int> Evaluate(IEnumerable<SetupPoint> points, double incumbent, List<CandidateRow> found)
    {
        var eligible = new List<SetupPoint>();
        foreach (var point in points.Distinct())
        {
            double ceiling = 0; foreach (var scorer in scorers) ceiling += scorer.UpperBound(point);
            if (ceiling / 3 + 1e-10 >= incumbent) eligible.Add(point); else stats.Pruned++;
        }
        var components = new List<Dictionary<SetupPoint, LapResult>>();
        foreach (var scorer in scorers)
        {
            var rows = new List<CandidateRow>();
            foreach (int slice in scorer.Evaluate(eligible, -1, rows)) yield return slice;
            components.Add(rows.ToDictionary(row => row.Point, row => row.Row));
        }
        foreach (var point in eligible) found.Add(new(point, LapResult.Average(components.Select(component => component[point]).ToArray())));
    }
}
