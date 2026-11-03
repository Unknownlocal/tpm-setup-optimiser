using System;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Fresh warmed tyres, with skill-adjusted windows and user-supplied water depth.</summary>
public static class TyreGrip
{
    public const int ModelLength = 5;

    public static double[] Compile(JsonElement compound, double water, double ambient, double skill)
    {
        var bands = Items(At(compound, "wetness_states")).ToArray();
        if (bands.Length == 0) throw new ArgumentException("Tyre compound has no wetness bands.");
        var band = bands.FirstOrDefault(b => water >= Number(At(b, "min_mm")) - 1e-9 && water <= Number(At(b, "max_mm")) + 1e-9);
        if (band.ValueKind == JsonValueKind.Undefined)
        {
            double Distance(JsonElement b) => Math.Max(Math.Max(Number(At(b, "min_mm")) - water, water - Number(At(b, "max_mm"))), 0);
            band = bands[0]; foreach (var next in bands.Skip(1)) if (Distance(next) < Distance(band)) band = next;
        }
        var window = Items(At(compound, "temp_window_c")).Select(value => Number(value)).ToArray();
        if (window.Length != 2) throw new ArgumentException("Tyre temperature window needs two values.");
        double shift = skill < 10 ? (skill - 10) * (5.0 / 9) : (skill - 10) * .5;
        double low = window[0] - shift, high = window[1] + shift;
        if (high < low) low = high = (low + high) * .5;
        // Fixed model: warmed target, temperature window and wetness-adjusted grip.
        return [ambient + (water > 1 ? 60 : 70), low, high,
            Number(At(compound, "lat_grip_base")) * Number(At(band, "lat_mult")), Number(At(compound, "long_grip_base")) * Number(At(band, "long_mult"))];
    }

    public static (double Temperature, double Lateral, double Longitudinal) Evaluate(ReadOnlySpan<double> model, double pressureDelta, bool protectedTemperature)
    {
        if (model.Length != ModelLength || !double.IsFinite(pressureDelta)) throw new ArgumentException("Invalid tyre model.");
        foreach (double value in model) if (!double.IsFinite(value)) throw new ArgumentException("Invalid tyre model value.");
        double temperature = Clamp(model[0] + pressureDelta, 20, 180);
        double thermal = protectedTemperature ? 1 : Math.Max(.8, 1 - .00005 * Math.Max(0, model[1] - temperature) - .00025 * Math.Max(0, temperature - model[2]));
        double lateral = model[3] * thermal, longitudinal = model[4] * thermal;
        if (!double.IsFinite(lateral) || !double.IsFinite(longitudinal)) throw new ArgumentException("Invalid tyre grip.");
        return (temperature, Clamp(lateral, .35, 1.25), Clamp(longitudinal, .3, 1.25));
    }

    /// <summary>Keep setup and tyre evaluation in one browser interop call per candidate batch.</summary>
    public static double[] Setups(ReadOnlySpan<double> setupModel, ReadOnlySpan<double> tyreModel, ReadOnlySpan<double> settings, bool protectedTemperature)
    {
        var setups = FormulaSetup.Evaluate(setupModel, settings);
        var output = new double[setups.Length / FormulaSetup.ResultLength * 11];
        for (int row = 0; row < setups.Length / FormulaSetup.ResultLength; row++)
        {
            var setup = setups.AsSpan(row * FormulaSetup.ResultLength, FormulaSetup.ResultLength);
            setup.CopyTo(output.AsSpan(row * 11));
            var grip = Evaluate(tyreModel, setup[5], protectedTemperature);
            output[row * 11 + 8] = grip.Temperature; output[row * 11 + 9] = grip.Lateral; output[row * 11 + 10] = grip.Longitudinal;
        }
        return output;
    }
}
