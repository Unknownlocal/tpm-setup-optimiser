using System;
using Tpm.Setup.Core;

/// <summary>Authored pace/preference cases and staged guidance with a tied wing plateau.</summary>
static class GradingChecks
{
    static void Near(double value, double expected)
    {
        if (!double.IsFinite(value) || Math.Abs(value - expected) > 1e-9) throw new Exception($"Grading: {value} != {expected}");
    }

    public static void Run()
    {
        Near(SetupGrading.PaceScore(.035, 90), 96.5);
        Near(SetupGrading.PaceScore(.07, 180), 96.5);
        var grade = SetupGrading.Assess(34, 50, 90.15, 20, 50, 90);
        Near(grade.Preference, 80); Near(grade.Pace, 86); Near(grade.Score, 85.1);
        if (SetupGrading.Labels()[grade.Grade] != "A") throw new Exception("Weighted setup grade changed.");
        Near(SetupGrading.Assess(20, 50, 89, 20, 50, 90).Score, 100);
        var average = SetupGrading.Average(98.7, 96.3, 91.2);
        Near(average.Score, 95.4);
        if (SetupGrading.Labels()[average.Grade] != "S") throw new Exception("Dry compound average grade changed.");

        var bounds = ReferenceGuidance.Bounds("""
        {"wing_levels":{"min_level":0,"neutral_level":10,"max_level":20},
         "suspension_setup":{"min_level":1,"neutral_level":3,"max_level":5},
         "tyre_pressures":{"front":{"min_psi":20,"neutral_psi":23,"max_psi":25},
                           "rear":{"min_psi":20,"neutral_psi":23,"max_psi":25}}}
        """);
        double[] best = []; double incumbent = 0;
        for (int stage = 0; stage < ReferenceGuidance.Stages; stage++)
        {
            var plan = ReferenceGuidance.Plan(bounds, stage, best);
            var times = new double[(plan.Length - 1) / 5];
            for (int i = 0; i < times.Length; i++)
            {
                var row = plan.AsSpan(1 + i * 5, 5);
                // All wing pairs in 4–8 tie. Refinement must retain the coarse winner.
                double front = Math.Max(Math.Max(4 - row[0], row[0] - 8), 0), rear = Math.Max(Math.Max(4 - row[1], row[1] - 8), 0);
                times[i] = 90 + front * front + rear * rear + Math.Pow(row[2] - 21.3, 2) + Math.Pow(row[3] - 22.6, 2);
            }
            int winner = ReferenceGuidance.Winner(times, plan[0] != 0 ? incumbent : 0);
            if (winner >= 0) { best = plan.AsSpan(1 + winner * 5, 5).ToArray(); incumbent = times[winner]; }
        }
        double[] expected = [6, 6, 21.3, 22.6, 1];
        for (int i = 0; i < expected.Length; i++) Near(best[i], expected[i]);
        Near(incumbent, 90);
        Console.WriteLine("Reference guidance and grading checks passed.");
    }
}
