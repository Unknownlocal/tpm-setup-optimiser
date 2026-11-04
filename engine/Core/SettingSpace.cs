using System;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Search coordinates follow the supplied axes; the verified Formula evaluator uses five physical fields.</summary>
public sealed class SettingSpace
{
    public static readonly string[] Keys = ["front_wing", "rear_wing", "front_pressure_psi", "rear_pressure_psi", "suspension_level"];
    public long[] Low { get; } = new long[5];
    public long[] High { get; } = new long[5];
    public long[] Coarse { get; } = new long[5];
    readonly double[] scale = new double[5];
    readonly int[] physical = new int[5];

    public SettingSpace(JsonElement axes)
    {
        var rows = Items(axes).ToArray();
        if (rows.Length != 5) throw new ArgumentException("The verified Formula search needs its five setup axes.");
        for (int i = 0; i < rows.Length; i++)
        {
            var axis = rows[i]; string key = Text(At(axis, "key")); physical[i] = Array.IndexOf(Keys, key);
            if (physical[i] < 0 || rows.Count(row => Text(At(row, "key")) == key) != 1) throw new ArgumentException("Invalid Formula setup axes.");
            scale[i] = Number(At(axis, "scale")); double step = Number(At(axis, "step"));
            if (scale[i] <= 0 || Math.Abs(step * scale[i] - 1) >= 1e-8) throw new ArgumentException($"Unsupported search step for {key}.");
            double low = Number(At(axis, "min")) * scale[i], high = Number(At(axis, "max")) * scale[i], coarse = Number(At(axis, "coarse"));
            if (!double.IsFinite(low) || !double.IsFinite(high) || high < low || high - low > 1000000 || Math.Abs(low) > 9007199254740991 || Math.Abs(high) > 9007199254740991
                || Math.Abs(low - Round(low)) >= 1e-7 || Math.Abs(high - Round(high)) >= 1e-7 || coarse < 1 || coarse > 9007199254740991 || coarse != Math.Truncate(coarse))
                throw new ArgumentException($"Unsupported search range for {key}.");
            Low[i] = Round(low); High[i] = Round(high); Coarse[i] = (long)coarse;
        }
    }

    static long Round(double value) => checked((long)Math.Floor(value + .5));
    public SetupPoint Ticks(double[] settings)
    {
        var result = new SetupPoint();
        for (int i = 0; i < 5; i++) result = result.With(i, Round(settings[physical[i]] * scale[i]));
        return result;
    }
    public double[] Settings(SetupPoint point)
    {
        var result = new double[5];
        for (int i = 0; i < 5; i++) result[physical[i]] = point[i] / scale[i];
        return result;
    }
    public static double[] ReadSettings(JsonElement settings) => Keys.Select(key => LapInput.Need(At(settings, key), key)).ToArray();
    public long Clamp(int axis, long value) => Math.Max(Low[axis], Math.Min(High[axis], value));
    public long Random(GameRandom random, int axis, long low, long high) => low + random.Integer(0, checked((int)(high - low)));
}
