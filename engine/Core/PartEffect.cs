using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Fitted development gains, including older seconds-based save formats.</summary>
internal sealed class PartEffect
{
    public static readonly string[] Zones = ["slow", "med", "high", "straight"];
    public static readonly string[] Ratings = [.. Zones, "team_pace", "acceleration", "braking", "tyre_management", "aero_efficiency_rating"];
    static readonly string[] Legacy = ["team_pace", "acceleration", "braking", "tyre_management", "tyre_wear", "reliability", "dirty_air", "car_mass_kg"];
    static readonly string[] Scalars = [.. Legacy, "lap_time", "lap_time_base", "aero_efficiency_rating", "ratio"];
    public Dictionary<string, double> RatingEffects;
    Dictionary<string, double>? pace, attr;
    readonly Dictionary<string, double> scalars;
    public readonly bool Seasonal;

    public PartEffect(JsonElement raw)
    {
        RatingEffects = Numbers(At(raw, "rating_effects"));
        pace = Has(raw, "pace") ? Numbers(At(raw, "pace")) : null;
        attr = Has(raw, "attr") ? Numbers(At(raw, "attr")) : null;
        scalars = Scalars.Where(key => Has(raw, key)).ToDictionary(key => key, key => Number(At(raw, key)));
        Seasonal = Flag(At(raw, "seasonal_package"));
    }

    static string Alias(string key) => key switch
    {
        "tyre_wear" => "tyre_management", "reliability" => "chassis_reliability",
        "dirty_air" => "dirty_air_sensitivity", _ => key,
    };
    public static double ClampRating(string key, double value) => Clamp(value, key == "aero_efficiency_rating" ? 0 : 1, 100);

    public void Scale(double multiplier)
    {
        if (Math.Abs(multiplier - 1) <= 1e-6) return;
        foreach (var map in new[] { pace, attr, RatingEffects })
            if (map != null) foreach (string key in map.Keys.ToArray()) map[key] *= multiplier;
        if (attr == null && pace != null) attr = new(pace);
        foreach (string key in scalars.Keys.ToArray()) scalars[key] *= multiplier;
    }

    public void Normalise()
    {
        var ratings = new Dictionary<string, double>(RatingEffects);
        if (ratings.Count == 0 && Seasonal)
        {
            foreach (string key in Zones)
                if (Math.Abs(pace?.GetValueOrDefault(key) ?? 0) > 1e-9) ratings[key] = pace![key];
            foreach (string key in Legacy)
                if (Math.Abs(scalars.GetValueOrDefault(key)) > 1e-9)
                {
                    string target = Alias(key);
                    ratings[target] = ratings.GetValueOrDefault(target) + scalars[key];
                }
        }
        var cleaned = new Dictionary<string, double>();
        foreach (var (key, value) in ratings)
        {
            string target = Alias(key);
            cleaned[target] = cleaned.GetValueOrDefault(target) + value;
        }
        if (cleaned.Count > 0)
        {
            if (scalars.TryGetValue("aero_efficiency_rating", out double aero) && cleaned.ContainsKey("aero_efficiency_rating"))
                cleaned["aero_efficiency_rating"] = aero;
            RatingEffects = cleaned;
        }
        if (attr == null && pace != null) attr = new(pace);
        if (!scalars.ContainsKey("tyre_management") && scalars.TryGetValue("tyre_wear", out double wear)) scalars["tyre_management"] = wear;
    }

    public void RemoveChassisBaseline(bool old)
    {
        scalars.Remove("aero_efficiency_rating"); RatingEffects.Remove("aero_efficiency_rating");
        // The snapshot already includes these gains; mass must never be added twice.
        if (Seasonal) { scalars.Remove("car_mass_kg"); RatingEffects.Remove("car_mass_kg"); return; }
        pace = attr = null;
        foreach (string key in new[] { "team_pace", "tyre_management", "tyre_wear", "car_mass_kg", "lap_time" }) scalars.Remove(key);
        foreach (string key in Zones.Concat(["team_pace", "tyre_management", "car_mass_kg"]))
            if (!(old && RatingEffects.GetValueOrDefault(key) < 0)) RatingEffects.Remove(key);
    }

    public void Apply(Dictionary<string, double> row, HashSet<string> unbounded, JsonElement constants)
    {
        Normalise();
        void Add(string key, double value)
        {
            if (key == "car_mass_kg") row[key] = Math.Max(640, row[key] + value);
            else if (Array.IndexOf(Ratings, key) >= 0) row[key] = unbounded.Contains(key) ? row[key] + value : ClampRating(key, row[key] + value);
        }
        if (RatingEffects.Count > 0) { foreach (var (key, value) in RatingEffects) Add(key, value); return; }
        void PaceDelta(string key, double value)
        {
            // Keep edited baseline excess through both legacy conversion clamps.
            double carry = unbounded.Contains(key) ? row[key] - 50 : 0;
            double seconds = (50 - Clamp(row[key] - carry, 0, 100)) * .1 + value;
            double rating = Clamp(50 - Clamp(seconds, -5, 5) / .1, 0, 100);
            row[key] = unbounded.Contains(key) ? carry + rating : ClampRating(key, rating);
        }
        foreach (string key in Zones) if (attr?.TryGetValue(key, out double value) == true) PaceDelta(key, value);
        foreach (string key in new[] { "team_pace", "acceleration", "braking" }) if (scalars.TryGetValue(key, out double value)) PaceDelta(key, value);
        foreach (string key in new[] { "tyre_management", "tyre_wear" }) if (scalars.TryGetValue(key, out double value))
        {
            double best = Number(At(constants, "TYRE_MANAGEMENT_MIN"), .5), worst = Number(At(constants, "TYRE_MANAGEMENT_MAX"), 1.5);
            double carry = unbounded.Contains("tyre_management") ? row["tyre_management"] - 50 : 0;
            double wear = worst + (best - worst) * Clamp(row["tyre_management"] - carry, 0, 100) / 100 + value;
            double rating = best == worst ? 50 : Clamp((wear - worst) / (best - worst) * 100, 0, 100);
            row["tyre_management"] = unbounded.Contains("tyre_management") ? carry + rating : ClampRating("tyre_management", rating);
        }
        foreach (string key in new[] { "aero_efficiency_rating", "car_mass_kg" }) if (scalars.TryGetValue(key, out double value)) Add(key, value);
    }
}
