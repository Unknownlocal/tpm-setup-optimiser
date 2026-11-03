using System;

namespace Tpm.Setup.Core;

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

    /// <summary>Input rows are balance, traction and lap time. Output rows are
    /// preference fit, pace score, nonnegative pace loss, combined score and grade index.</summary>
    public static double[] Assess(double[] rows, double preferredBalance, double preferredTraction, double reference)
    {
        if (rows.Length % 3 != 0 || rows.Length > 64 * 3) throw new ArgumentException("Invalid setup grading batch.");
        var result = new double[rows.Length / 3 * 5];
        for (int i = 0; i < rows.Length / 3; i++)
        {
            double fit = Preference(rows[i * 3], rows[i * 3 + 1], preferredBalance, preferredTraction);
            // Staged guidance can be beaten. A faster lap still receives at most 100 pace points.
            double delta = Math.Max(0, Finite(rows[i * 3 + 2]) - reference), pace = PaceScore(delta, reference);
            // The final grade favours pace: 85% pace and 15% driver preference fit.
            double score = .85 * pace + .15 * fit;
            result[i * 5] = fit; result[i * 5 + 1] = pace; result[i * 5 + 2] = delta; result[i * 5 + 3] = score; result[i * 5 + 4] = Grade(score);
        }
        return result;
    }

    /// <summary>Average independently graded soft/medium/hard scores for one shared setup.
    /// Each component has already used its own reference; assign the letter grade afterwards.</summary>
    public static double[] Average(double[] scores)
    {
        if (scores.Length != 3) throw new ArgumentException("A dry average needs three compound scores.");
        double sum = 0; foreach (double score in scores) sum += Finite(score);
        double average = sum / scores.Length;
        return [average, Grade(average)];
    }

    /// <summary>Add preference fit and its best-possible grade score to physical setup rows,
    /// keeping search pruning on the same rules without another interop call per candidate.</summary>
    public static double[] Setups(double[] model, double[] tyres, double[] settings, bool protectedTemperature, double preferredBalance, double preferredTraction)
    {
        var physical = TyreGrip.Setups(model, tyres, settings, protectedTemperature);
        // Keep the eleven physical fields, then append preference fit and the score ceiling.
        var result = new double[physical.Length / 11 * 13];
        for (int i = 0; i < physical.Length / 11; i++)
        {
            var row = physical.AsSpan(i * 11, 11); row.CopyTo(result.AsSpan(i * 13));
            // Physical fields 6/7 are balance/traction. Even a perfect lap contributes
            // only 85 points, so this ceiling can reject candidates before simulating a lap.
            double fit = Preference(row[6], row[7], preferredBalance, preferredTraction);
            result[i * 13 + 11] = fit; result[i * 13 + 12] = 85 + .15 * fit;
        }
        return result;
    }
}
