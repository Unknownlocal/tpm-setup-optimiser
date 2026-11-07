using System;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>One fixed scoring policy shared by grading, search bounds and dry averages.</summary>
public sealed class GradingWeights
{
    public static GradingWeights Default { get; } = new(85);
    readonly double pace, preference;

    public GradingWeights(double pacePercent)
    {
        if (!double.IsFinite(pacePercent) || pacePercent < 0 || pacePercent > 100)
            throw new ArgumentException("Pace weight must be between 0 and 100 percent.");
        // Divide both shares separately to retain the original .85/.15 calculation at the default.
        pace = pacePercent / 100; preference = (100 - pacePercent) / 100;
    }

    public static GradingWeights Read(JsonElement source) => Has(source, "pace_weight_pct")
        ? new(Required(At(source, "pace_weight_pct"), "pace weight")) : Default;

    public double Combine(double paceScore, double preferenceScore) => Math.Min(100, pace * paceScore + preference * preferenceScore);
}
