using System;
using System.Collections.Generic;
using System.Linq;

namespace Tpm.Setup.Core;

/// <summary>Reference cache exists only during one compound's guidance, yielding after each 16 new laps.</summary>
public sealed class ReferenceSolver
{
    public ReferenceResult? Result { get; private set; }
    readonly DriverScenario scenario;
    readonly int compound;

    public ReferenceSolver(DriverScenario scenario, int compound) { this.scenario = scenario; this.compound = compound; }

    public IEnumerable<int> Solve()
    {
        var cache = new Dictionary<(double, double, double, double, double), LapResult>();
        // Match the game's pressure precision; retain the first calculation when guidance repeats a point.
        static (double, double, double, double, double) Key(double[] s) => (s[0], s[1], s[4], Math.Floor(s[2] * 10 + .5), Math.Floor(s[3] * 10 + .5));
        LapResult? best = null;
        for (int stage = 0; stage < ReferenceGuidance.Stages; stage++)
        {
            var plan = ReferenceGuidance.Plan(scenario.ReferenceBounds, stage, best?.Settings ?? []);
            var settings = new double[(plan.Length - 1) / 5][];
            for (int i = 0; i < settings.Length; i++) settings[i] = plan.AsSpan(1 + i * 5, 5).ToArray();
            int batch = 0;
            foreach (var s in settings) if (!cache.ContainsKey(Key(s)))
            {
                cache[Key(s)] = scenario.Evaluate(compound, s);
                if (++batch == 16) { batch = 0; yield return 0; }
            }
            if (batch > 0) yield return 0;
            var rows = settings.Select(s => cache[Key(s)]).ToArray();
            int winner = ReferenceGuidance.Winner(rows.Select(row => row.Lap).ToArray(), plan[0] != 0 && best != null ? best.Lap : 0);
            if (winner >= 0) best = rows[winner];
        }
        Result = new(best!.Settings, best.Lap, cache.Count);
        cache.Clear();
    }
}
