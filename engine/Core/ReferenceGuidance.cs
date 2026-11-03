using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>The game's five guidance stages; refinement stages preserve their incumbent on ties.</summary>
public static class ReferenceGuidance
{
    public const int Stages = 5, SettingLength = 5;

    /// <summary>Compile wing, suspension and front/rear pressure bounds (min/neutral/max).
    /// Preserve configured neutral pressures; only pressure grids use integer tenths.</summary>
    public static double[] Bounds(string json)
    {
        using var document = JsonDocument.Parse(json); var cfg = document.RootElement;
        var result = new List<double>(12);
        void Axis(JsonElement axis, bool pressure)
        {
            string[] keys = pressure ? ["min_psi", "neutral_psi", "max_psi"] : ["min_level", "neutral_level", "max_level"];
            double[] values = keys.Select(key => Required(At(axis, key), $"reference {key}")).ToArray();
            double scale = pressure ? 10 : 1;
            // Whole levels must be exact; pressure tenths tolerate the original rounding noise.
            if (values.Any(value => !double.IsFinite(value * scale) || Math.Abs(value * scale - Math.Round(value * scale)) >= (pressure ? 1e-8 : double.Epsilon))
                || values[0] > values[1] || values[1] > values[2] || values[2] - values[0] > (pressure ? 20 : 50))
                throw new ArgumentException(pressure ? "Reference guidance needs pressure bounds in tenths of a psi, spanning at most 20 psi, with neutral inside the range."
                    : "Reference guidance needs whole-number wing/suspension ranges of at most 51 settings, with neutral inside the range.");
            result.AddRange(values);
        }
        Axis(At(cfg, "wing_levels"), false); Axis(At(cfg, "suspension_setup"), false);
        Axis(At(At(cfg, "tyre_pressures"), "front"), true); Axis(At(At(cfg, "tyre_pressures"), "rear"), true);
        return result.ToArray();
    }

    static IEnumerable<double> Range(double low, double high, int step = 1)
    {
        double count = Math.Max(0, Math.Floor((high - low) / step) + 1);
        if (!double.IsFinite(count) || count > 1000) throw new ArgumentException("Reference grid exceeds its supported range.");
        for (int i = 0; i < count; i++) yield return low + i * step;
    }
    static double[] Coarse(double low, double neutral, double high, int step) =>
        Range(low, high, step).Append(high).Append(neutral).Distinct().Order().ToArray();
    static double Tick(double pressure) => Math.Round(pressure * 10);

    /// <summary>Return a retain-incumbent flag followed by five-value candidate rows:
    /// front/rear wing, front/rear pressure, suspension. The worker schedules their laps.</summary>
    public static double[] Plan(double[] bounds, int stage, double[] previous)
    {
        if (bounds.Length != 12 || stage < 0 || stage >= Stages || (stage != 0 && previous.Length != SettingLength))
            throw new ArgumentException("Invalid reference stage.");
        foreach (double value in bounds.Concat(previous)) if (!double.IsFinite(value)) throw new ArgumentException("Invalid reference stage value.");
        // Start at neutral. Later stages hold the previous winner's other settings fixed.
        double[] anchor = stage == 0 ? [bounds[1], bounds[1], bounds[7], bounds[10], bounds[4]] : previous;
        // Only local refinement compares against the previous winner; coarse stages start afresh.
        var result = new List<double> { stage is 1 or 4 ? 1 : 0 };
        void Add(double front, double rear, double frontPressure, double rearPressure, double suspension) =>
            result.AddRange([front, rear, frontPressure, rearPressure, suspension]);
        if (stage <= 1)
        {
            // Stages 0/1: coarse wing pairs, then every pair within two clicks of the winner.
            var fronts = stage == 0 ? Coarse(bounds[0], bounds[1], bounds[2], 3) : Range(Math.Max(bounds[0], anchor[0] - 2), Math.Min(bounds[2], anchor[0] + 2));
            var rears = stage == 0 ? Coarse(bounds[0], bounds[1], bounds[2], 3) : Range(Math.Max(bounds[0], anchor[1] - 2), Math.Min(bounds[2], anchor[1] + 2));
            foreach (double front in fronts) foreach (double rear in rears) Add(front, rear, anchor[2], anchor[3], anchor[4]);
        }
        // Stage 2: try every suspension level with the selected wings.
        else if (stage == 2)
            foreach (double level in Range(bounds[3], bounds[5])) Add(anchor[0], anchor[1], anchor[2], anchor[3], level);
        else
        {
            // Stages 3/4: coarse pressures (front 1 psi, rear 0.5 psi), then 0.1 psi
            // refinement within 0.5 psi. Iteration order also determines which tied row wins.
            var fronts = stage == 3 ? Coarse(Tick(bounds[6]), Tick(bounds[7]), Tick(bounds[8]), 10) : Range(Math.Max(Tick(bounds[6]), Tick(anchor[2]) - 5), Math.Min(Tick(bounds[8]), Tick(anchor[2]) + 5));
            var rears = stage == 3 ? Coarse(Tick(bounds[9]), Tick(bounds[10]), Tick(bounds[11]), 5) : Range(Math.Max(Tick(bounds[9]), Tick(anchor[3]) - 5), Math.Min(Tick(bounds[11]), Tick(anchor[3]) + 5));
            foreach (double front in fronts) foreach (double rear in rears) Add(anchor[0], anchor[1], front / 10, rear / 10, anchor[4]);
        }
        return result.ToArray();
    }

    /// <summary>Zero incumbent time starts a new stage; -1 retains an earlier tied winner.</summary>
    public static int Winner(double[] times, double incumbent)
    {
        if (!double.IsFinite(incumbent) || incumbent < 0) throw new ArgumentException("Invalid reference incumbent.");
        double best = incumbent == 0 ? double.PositiveInfinity : incumbent; int index = -1;
        for (int i = 0; i < times.Length; i++)
        {
            if (!double.IsFinite(times[i]) || times[i] <= 0) throw new ArgumentException("Invalid reference lap.");
            // Strict improvement keeps the first candidate, or retained incumbent, on a tie.
            if (times[i] < best) { best = times[i]; index = i; }
        }
        return index;
    }
}
