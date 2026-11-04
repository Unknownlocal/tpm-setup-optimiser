using System;

namespace Tpm.Setup.Core;

/// <summary>One setup's preference, pace and combined grade.</summary>
public readonly record struct SetupAssessment(double Preference, double Pace, double Delta, double Score, int Grade);

/// <summary>Score a simulated setup against its compound's reference lap and the driver's
/// preferred balance/traction. Scores run from 0 to 100; grade indices are for the browser bridge.</summary>
public static class SetupGrading
{
    // Paired anchors: seconds lost on a normalised 90-second lap and the resulting pace score.
    // Values between anchors are interpolated, rather than rounded to the nearest grade.
    static readonly double[] Loss = [0, .02, .05, .1, .2, .35, .55, .8, 1.1, 1.5, 2];
    static readonly double[] Pace = [100, 98, 95, 90, 82, 73, 64, 52, 38, 24, 0];
    // Descending inclusive thresholds share their indices with Labels(); the final label is F.
    static readonly double[] Cutoffs = [98, 95, 90, 82, 73, 64, 52, 38, 24];
    public static string[] Labels() => ["S+", "S", "A+", "A", "B+", "B", "C", "D", "E", "F"];

    static double Finite(double value)
    {
        if (!double.IsFinite(value)) throw new ArgumentException("Setup grading needs finite values.");
        return value;
    }

    /// <summary>Return the first grade whose threshold is met, including exact boundary scores.</summary>
    public static int Grade(double score)
    {
        Finite(score);
        for (int i = 0; i < Cutoffs.Length; i++) if (score >= Cutoffs[i]) return i;
        return Cutoffs.Length;
    }

    /// <summary>Penalise balance and traction mismatch equally, in either direction.
    /// A combined mismatch of 70 points exhausts the preference score.</summary>
    public static double Preference(double balance, double traction, double preferredBalance, double preferredTraction) =>
        100 * Math.Max(0, 1 - (Math.Abs(Finite(balance) - Finite(preferredBalance)) + Math.Abs(Finite(traction) - Finite(preferredTraction))) / 70);

    /// <summary>Convert lap-time loss to the game's pace score, independent of circuit length.</summary>
    public static double PaceScore(double delta, double reference)
    {
        Finite(reference);
        if (reference <= 0) throw new ArgumentException("A reference lap must be positive.");
        // The same proportional loss should score equally on short and long reference laps.
        double normalised = Math.Max(0, Finite(delta)) * 90 / reference;
        for (int i = 1; i < Loss.Length; i++) if (normalised <= Loss[i])
            return Pace[i - 1] + (Pace[i] - Pace[i - 1]) * ((normalised - Loss[i - 1]) / (Loss[i] - Loss[i - 1]));
        // Losses beyond the last anchor have no remaining pace points.
        return 0;
    }

    /// <summary>Combine one lap's pace and driver preference fit into a grade.</summary>
    public static SetupAssessment Assess(double balance, double traction, double lap, double preferredBalance, double preferredTraction, double reference)
    {
        double fit = Preference(balance, traction, preferredBalance, preferredTraction);
        // Staged guidance can be beaten. A faster lap still receives at most 100 pace points.
        double delta = Math.Max(0, Finite(lap) - reference), pace = PaceScore(delta, reference);
        // The final grade favours pace: 85% pace and 15% driver preference fit.
        double score = .85 * pace + .15 * fit;
        return new(fit, pace, delta, score, Grade(score));
    }

    /// <summary>Average independently graded soft/medium/hard scores for one shared setup.
    /// Each component has already used its own reference; assign the letter grade afterwards.</summary>
    public static (double Score, int Grade) Average(double soft, double medium, double hard)
    {
        double average = (Finite(soft) + Finite(medium) + Finite(hard)) / 3;
        return (average, Grade(average));
    }

}
