using System;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Fresh warmed tyres, with skill-adjusted windows and user-supplied water depth.</summary>
public sealed class TyreGrip
{
    readonly double target, low, high, lateral, longitudinal;

    TyreGrip(double target, double low, double high, double lateral, double longitudinal)
    {
        foreach (double value in new[] { target, low, high, lateral, longitudinal })
            if (!double.IsFinite(value)) throw new ArgumentException("Invalid tyre model value.");
        this.target = target; this.low = low; this.high = high;
        this.lateral = lateral; this.longitudinal = longitudinal;
    }

    public static TyreGrip Compile(JsonElement compound, double water, double ambient, double skill)
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
        return new(ambient + (water > 1 ? 60 : 70), low, high,
            Number(At(compound, "lat_grip_base")) * Number(At(band, "lat_mult")), Number(At(compound, "long_grip_base")) * Number(At(band, "long_mult")));
    }

    /// <summary>Apply the setup's pressure effect to the compiled warmed target, then calculate grip.</summary>
    public (double Temperature, double Lateral, double Longitudinal) Evaluate(double pressureDelta, bool protectedTemperature)
    {
        if (!double.IsFinite(pressureDelta)) throw new ArgumentException("Invalid tyre pressure effect.");
        double temperature = Clamp(target + pressureDelta, 20, 180);
        double thermal = protectedTemperature ? 1 : Math.Max(.8, 1 - .00005 * Math.Max(0, low - temperature) - .00025 * Math.Max(0, temperature - high));
        double lat = lateral * thermal, lon = longitudinal * thermal;
        if (!double.IsFinite(lat) || !double.IsFinite(lon)) throw new ArgumentException("Invalid tyre grip.");
        return (temperature, Clamp(lat, .35, 1.25), Clamp(lon, .3, 1.25));
    }
}
