using System;
using System.Collections.Generic;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Compile fixed definitions once; evaluate candidate settings as numerical batches.</summary>
public static class FormulaSetup
{
    public const int ModelLength = 66, SettingLength = 5, ResultLength = 8;
    // Packed sections: wing bounds 0–2, diminishing returns 3–7, wing gains 8–15,
    // aero 16–21, concept feel 22–23, pressure axes 24–53, suspension 54–64,
    // driver balance preference 65. Keep the browser contract version in sync.
    const int FrontAxis = 24, RearAxis = 39, SuspensionAxis = 54;
    static readonly string[] PressureKeys = [.. PartEffect.Zones, "accel_ms2", "target_temp_delta_c"];

    internal static double[] Compile(JsonElement cfg, double aero, double balance, double traction, double preferredBalance)
    {
        var wing = At(cfg, "wing_levels"); var dim = At(wing, "diminishing_returns"); var ac = At(wing, "aero_efficiency");
        var result = new List<double>(ModelLength);
        void Bounds(JsonElement axis, bool pressure = false)
        {
            foreach (string key in pressure ? new[] { "min_psi", "neutral_psi", "max_psi" } : new[] { "min_level", "neutral_level", "max_level" })
                result.Add(Required(At(axis, key), $"setup {key}"));
        }
        Bounds(wing);
        double low = OrNumber(At(dim, "min_efficiency"), .7), high = OrNumber(At(dim, "max_efficiency"), 1);
        result.AddRange([At(dim, "enabled").ValueKind == JsonValueKind.False ? 0 : 1, Number(At(dim, "coefficient"), .025), OrNumber(At(dim, "exponent"), 1.35), Math.Min(low, high), Math.Max(low, high)]);
        foreach (string side in new[] { "front_per_click_kmh", "rear_per_click_kmh" })
            foreach (string key in PartEffect.Zones) result.Add(Required(At(At(wing, side), key), $"wing {key}"));
        low = Number(At(ac, "minimum_drag_penalty_multiplier"), .5); high = Number(At(ac, "maximum_drag_penalty_multiplier"), 1.5);
        result.AddRange([At(ac, "enabled").ValueKind == JsonValueKind.False ? 0 : 1, Clamp(Number(At(ac, "neutral_rating"), 50), 1, 100), Math.Max(0, Number(At(ac, "drag_penalty_strength"), .5)), Math.Min(low, high), Math.Max(low, high), aero, balance, traction]);
        void Effects(JsonElement axis, bool pressure)
        {
            Bounds(axis, pressure);
            foreach (string side in new[] { "min_effects", "max_effects" })
                foreach (string key in pressure ? PressureKeys : PartEffect.Zones) result.Add(Number(At(At(axis, side), key)));
        }
        Effects(At(At(cfg, "tyre_pressures"), "front"), true);
        Effects(At(At(cfg, "tyre_pressures"), "rear"), true);
        Effects(At(cfg, "suspension_setup"), false);
        result.Add(preferredBalance);
        return result.ToArray();
    }

    static double Axis(double value, double low, double neutral, double high, double below, double above) =>
        value < neutral ? Clamp((neutral - value) / Math.Max(1e-9, neutral - low), 0, 1) * below
            : Clamp((value - neutral) / Math.Max(1e-9, high - neutral), 0, 1) * above;

    /// <summary>Rows are front/rear wing, front/rear pressure, suspension. Results are
    /// four zone deltas, pressure acceleration/temperature, balance and traction.</summary>
    public static double[] Evaluate(ReadOnlySpan<double> model, ReadOnlySpan<double> settings)
    {
        if (model.Length != ModelLength || settings.Length % SettingLength != 0 || settings.Length > SettingLength * 64)
            throw new ArgumentException("Invalid car setup batch dimensions.");
        foreach (double value in model) if (!double.IsFinite(value)) throw new ArgumentException("Invalid car setup model.");
        foreach (double value in settings) if (!double.IsFinite(value)) throw new ArgumentException("Invalid car setup setting.");
        var output = new double[settings.Length / SettingLength * ResultLength];
        for (int row = 0; row < settings.Length / SettingLength; row++)
        {
            var s = settings.Slice(row * SettingLength, SettingLength); var result = output.AsSpan(row * ResultLength, ResultLength);
            double front = s[0] - model[1], rear = s[1] - model[1], distance = Math.Sqrt(front * front + rear * rear);
            double efficiency = model[3] == 0 ? 1 : Clamp(1 - model[4] * (distance > 0 ? Math.Pow(distance, model[5]) : 0), model[6], model[7]);
            for (int key = 0; key < 4; key++) result[key] = (model[8 + key] * front + model[12 + key] * rear) * efficiency;
            if (result[3] < 0 && model[16] != 0)
                result[3] *= Clamp(1 - model[18] * ((model[21] - model[17]) / model[17]), model[19], model[20]);
            double balance = Clamp(model[22] + Axis(s[0], model[0], model[1], model[2], -30, 30)
                + Axis(s[1], model[0], model[1], model[2], 20, -20)
                + Axis(s[4], model[SuspensionAxis], model[SuspensionAxis + 1], model[SuspensionAxis + 2], -20, 20), 0, 100);
            double traction = Clamp(model[23] + Axis(s[1], model[0], model[1], model[2], -20, 20)
                + Axis(s[4], model[SuspensionAxis], model[SuspensionAxis + 1], model[SuspensionAxis + 2], 20, -20)
                + Axis(s[2], model[FrontAxis], model[FrontAxis + 1], model[FrontAxis + 2], -10, 10)
                + Axis(s[3], model[RearAxis], model[RearAxis + 1], model[RearAxis + 2], 10, -10), 0, 100);
            for (int key = 0; key < 6; key++)
            {
                double pressure = Axis(s[2], model[FrontAxis], model[FrontAxis + 1], model[FrontAxis + 2], model[FrontAxis + 3 + key], model[FrontAxis + 9 + key])
                    + Axis(s[3], model[RearAxis], model[RearAxis + 1], model[RearAxis + 2], model[RearAxis + 3 + key], model[RearAxis + 9 + key]);
                if (key < 4) result[key] += pressure + Axis(s[4], model[SuspensionAxis], model[SuspensionAxis + 1], model[SuspensionAxis + 2], model[SuspensionAxis + 3 + key], model[SuspensionAxis + 7 + key])
                    - (key == 3 ? 0 : Math.Abs(balance - model[65]) * .015);
                else result[key] = pressure;
            }
            result[6] = balance; result[7] = traction;
        }
        return output;
    }
}
