using System.Collections.Generic;

namespace Tpm.Setup.Core;

/// <summary>Refinement begins at the first S+; only material gains reset the stall counter.</summary>
public sealed class SearchCase
{
    public sealed class Refinement
    {
        public int Laps, StaleLaps, IdleBatches;
        public double Milestone, FirstScore;
    }
    public CandidateScorer Scorer { get; }
    public LapResult Best { get; private set; }
    public SetupPoint Reference { get; }
    public SetupPoint Anchor { get; set; }
    public int Round { get; set; }
    public Refinement? Progress { get; private set; }
    public string? StopReason { get; private set; }
    readonly SettingSpace space;

    public SearchCase(CandidateScorer scorer, LapResult best, SetupPoint reference, SettingSpace space)
    { Scorer = scorer; Best = best; Reference = reference; Anchor = space.Ticks(best.Settings); this.space = space; }

    public void Advance(IEnumerable<CandidateRow> found, int laps, SearchLimits limits, bool generated)
    {
        foreach (var candidate in found) if (candidate.Row.Score > Best.Score) { Best = candidate.Row; Anchor = candidate.Point; }
        if (Progress != null)
        {
            Progress.Laps += laps; Progress.StaleLaps += laps;
            bool gained = Best.Score - Progress.Milestone >= .01 - 1e-10;
            if (gained) { Progress.Milestone = Best.Score; Progress.StaleLaps = 0; }
            if (laps > 0 || gained) Progress.IdleBatches = 0; else if (generated) Progress.IdleBatches++;
        }
        else if (Best.Grade == 0) Progress = new() { Milestone = Best.Score, FirstScore = Best.Score };
        StopReason = Best.Score >= 100 ? "perfect" : Progress?.Laps >= limits.RefineLaps ? "refinement" : Progress?.StaleLaps >= limits.StallLaps ? "stall" : Progress?.IdleBatches >= limits.IdleBatches ? "idle" : null;
    }

    public void AdoptKnown(SearchLimits limits)
    {
        if (Scorer.BestKnown is { } known) Advance([new(space.Ticks(known.Settings), known)], 0, limits, false);
    }

    public IEnumerable<SetupPoint> Candidates(SettingSpace space, GameRandom random)
    {
        bool coarse = Round++ % 3 == 0;
        long Step(int axis) => coarse ? space.Coarse[axis] : 1;
        for (int axis = 0; axis < 5; axis++) foreach (int sign in new[] { -1, 1 }) yield return Anchor.With(axis, space.Clamp(axis, Anchor[axis] + sign * Step(axis)));
        for (int attempt = 0; attempt < 38; attempt++)
        {
            var point = Anchor;
            if (attempt < 8)
                for (int axis = 0; axis < 5; axis++) point = point.With(axis, space.Random(random, axis, space.Low[axis], space.High[axis]));
            else if (attempt < 20)
                for (int axis = 0; axis < 5; axis++) point = point.With(axis, space.Random(random, axis, System.Math.Max(space.Low[axis], Reference[axis] - space.Coarse[axis]), System.Math.Min(space.High[axis], Reference[axis] + space.Coarse[axis])));
            else foreach (int axis in random.SampleIndices(5, 2)) point = point.With(axis, space.Clamp(axis, point[axis] + (random.Integer(0, 1) == 0 ? -1 : 1) * Step(axis)));
            yield return point;
        }
    }
}
