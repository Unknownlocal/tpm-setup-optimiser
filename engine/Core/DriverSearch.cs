using System;
using System.Collections.Generic;
using System.Linq;

namespace Tpm.Setup.Core;

/// <summary>Per-entry references, search objectives and RNG. Iterators keep batch boundaries cancellable.</summary>
public sealed class DriverSearch : IDisposable
{
    public DriverScenario Scenario { get; }
    public SearchStats Stats { get; } = new();
    public List<SearchCase> Cases { get; } = [];
    public List<LapResult> Graded { get; } = [];
    public string? CurrentReference { get; private set; }
    public bool Ready { get; private set; }
    public bool HasActive => Cases.Any(state => state.StopReason == null);
    public int CacheEntries => scorers.Sum(scorer => scorer.CacheEntries);
    readonly List<CompoundSearch> scorers = [];
    readonly SearchLimits limits;
    readonly GameRandom random;
    int cursor;

    public DriverSearch(DriverScenario scenario, SearchLimits limits, int seed) { Scenario = scenario; this.limits = limits; random = new((ulong)seed); }

    public IEnumerable<int> Prepare(bool gradeOnly)
    {
        var entered = new List<LapResult>();
        if (gradeOnly) for (int i = 0; i < Scenario.Compounds.Length; i++) { entered.Add(Scenario.Evaluate(i, Scenario.Initial, true)); yield return 0; }
        for (int i = 0; i < Scenario.Compounds.Length; i++)
        {
            CurrentReference = Scenario.Compounds[i]; yield return 0;
            var solver = new ReferenceSolver(Scenario, i);
            foreach (int slice in solver.Solve()) yield return slice;
            var reference = solver.Result!; Stats.ReferenceLaps += reference.Evaluated;
            if (gradeOnly) entered[i].Assess(Scenario.BalancePreference, Scenario.TractionPreference, reference);
            else scorers.Add(new(Scenario, i, reference, Stats));
        }
        if (gradeOnly)
        {
            var dry = new[] { "soft", "medium", "hard" }.Select(name => entered.Find(row => row.Compound == name)).ToArray();
            if (dry.All(row => row != null)) Graded.Add(LapResult.Average(dry.Select(row => row!).ToArray()));
            Graded.AddRange(entered);
        }
        else
        {
            foreach (var scorer in scorers)
            {
                var found = new List<CandidateRow>();
                foreach (int slice in scorer.Evaluate([Scenario.Space.Ticks(scorer.Reference.Settings), Scenario.Space.Ticks(Scenario.Initial)], -1, found)) yield return slice;
                var best = found.Aggregate((best, row) => row.Row.Score > best.Row.Score ? row : best);
                Cases.Add(new(scorer, best.Row, Scenario.Space.Ticks(scorer.Reference.Settings), Scenario.Space));
            }
            var dry = new[] { "soft", "medium", "hard" }.Select(name => scorers.Find(scorer => scorer.Name == name)).ToArray();
            if (dry.All(scorer => scorer != null))
            {
                var scorer = new AverageSearch(dry.Select(scorer => scorer!).ToArray(), Stats); var found = new List<CandidateRow>();
                var seeds = dry.Select(scorer => Scenario.Space.Ticks(scorer!.Reference.Settings)).Append(Scenario.Space.Ticks(Scenario.Initial));
                foreach (int slice in scorer.Evaluate(seeds, -1, found)) yield return slice;
                var best = found.Aggregate((best, row) => row.Row.Score > best.Row.Score ? row : best);
                Cases.Insert(0, new(scorer, best.Row, best.Point, Scenario.Space));
            }
            foreach (var state in Cases) state.Advance([], 0, limits, false);
            Stats.PreparationLaps = Stats.Evaluated; Stats.Evaluated = 0;
        }
        CurrentReference = null; Ready = true;
    }

    public IEnumerable<int> Step()
    {
        var active = Cases.Where(state => state.StopReason == null).ToArray();
        if (active.Length == 0) yield break;
        var state = active[cursor++ % active.Length]; state.AdoptKnown(limits);
        IEnumerable<int> Consider(IEnumerable<SetupPoint> values, double incumbent, bool generated, List<CandidateRow> found)
        {
            int before = Stats.Evaluated;
            foreach (int slice in state.Scorer.Evaluate(values, incumbent, found)) yield return slice;
            state.Advance(found, Stats.Evaluated - before, limits, generated);
        }
        if (state.StopReason == null && state.Best.Compound == "avg_dry")
        {
            var values = Cases.Where(state => state.Best.Compound is "soft" or "medium" or "hard").Select(state => Scenario.Space.Ticks(state.Best.Settings));
            foreach (int slice in Consider(values, -1, false, [])) yield return slice;
        }
        if (state.StopReason == null)
        {
            double previous = state.Best.Score; var found = new List<CandidateRow>();
            // Materialise every proposal before scoring: random draw order is independent of pruning.
            var values = state.Candidates(Scenario.Space, random).ToArray();
            foreach (int slice in Consider(values, state.Best.Score, true, found)) yield return slice;
            if (found.Count > 0 && state.Best.Score == previous && state.Round % 4 == 0) state.Anchor = found[random.Integer(0, found.Count - 1)].Point;
        }
    }

    public void Dispose() { foreach (var scorer in scorers) scorer.Clear(); scorers.Clear(); Cases.Clear(); Graded.Clear(); }
}
