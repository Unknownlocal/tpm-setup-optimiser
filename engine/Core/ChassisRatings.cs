using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Reconstruct only the assigned package, in the save's fitted-part order.</summary>
internal static class ChassisRatings
{
    static readonly string[] OldKeys = [.. PartEffect.Zones, "team_pace", "acceleration", "braking"];
    readonly record struct ChassisSnapshot(JsonElement Item, JsonElement Effect, string Name, string Id, double? Year);

    public static (Dictionary<string, double> Row, JsonElement Chassis) Build(JsonElement source, JsonElement driver)
    {
        var definitions = At(source, "definitions"); var team = At(source, "teamInputs");
        var designs = Items(At(team, "chassis_designs")).ToArray();
        var order = Items(At(At(definitions, "car_parts"), "order")).Select(value => Text(value)).ToHashSet();
        var fitted = Items(At(driver, "parts")).Where(part => order.Contains(Text(At(part, "category")))).ToArray();
        var chassis = ResolveChassis(fitted, designs);
        var (row, unbounded) = Baseline(chassis.Effect);
        double? year = chassis.Year ?? NamedYear(chassis.Name);
        bool old = chassis.Name.ToLowerInvariant().Contains("(old)") || year < Number(At(source, "calendarYear"));
        var constants = At(definitions, "constants");
        double penalty = Math.Max(0, Number(At(constants, "OLD_CHASSIS_RATING_PENALTY"), 5));

        foreach (var part in fitted)
        {
            string category = Text(At(part, "category"));
            bool isChassis = category == "chassis";
            var installed = isChassis ? chassis.Item : At(part, "item");
            var raw = isChassis ? chassis.Effect : At(installed, "effect");
            var effect = new PartEffect(raw);
            if (isChassis && old) Penalise(effect, penalty);
            double multiplier = Understanding(source, category, installed);
            if (isChassis && effect.Seasonal) ApplySeasonalUnderstanding(effect, raw, designs, chassis, multiplier);
            else effect.Scale(multiplier);
            if (isChassis)
            {
                effect.RemoveChassisBaseline(old);
                // Understanding cannot soften an old-chassis penalty.
                if (old) Penalise(effect, penalty);
            }
            effect.Apply(row, unbounded, constants);
        }
        ApplyPotentialLimits(row, chassis.Effect, team);
        return (row, chassis.Effect);
    }

    static ChassisSnapshot ResolveChassis(JsonElement[] fitted, JsonElement[] designs)
    {
        var item = At(fitted.First(part => Text(At(part, "category")) == "chassis"), "item");
        string name = Text(At(item, "name")), id = Text(At(item, "design_id"));
        var savedYear = At(item, "design_year");
        double? year = savedYear.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? null : Number(savedYear);
        var effect = At(item, "effect");
        if (!Nonempty(effect))
        {
            var design = designs.FirstOrDefault(entry => id.Length > 0
                ? $"chassis:{Number(At(entry, "year"))}:{Number(At(entry, "index"))}" == id : Text(At(entry, "name")) == name);
            if (Nonempty(At(design, "effect")))
            {
                effect = At(design, "effect");
                double designYear = Number(At(design, "year")), index = Number(At(design, "index"));
                // Only absent fields inherit identity: an explicit empty/null field still counts as present.
                if (!Has(item, "design_id") && designYear > 0 && index > 0) id = $"chassis:{designYear}:{index}";
                if (!Has(item, "design_year") && designYear > 0) year = designYear;
            }
        }
        return new(item, effect, name, id, year);
    }

    static (Dictionary<string, double> Row, HashSet<string> Unbounded) Baseline(JsonElement chassis)
    {
        var baseline = At(chassis, "baseline_targets");
        if (!Nonempty(baseline)) throw new ArgumentException("This lap preview needs a fitted chassis baseline snapshot.");
        var unbounded = Items(At(chassis, "baseline_edit_keys")).Select(value => Text(value)).ToHashSet();
        unbounded.Add("aero_efficiency_rating");
        var row = PartEffect.Ratings.ToDictionary(key => key, key =>
        {
            double value = Required(At(baseline, key), key);
            return unbounded.Contains(key) && key != "aero_efficiency_rating" ? value : PartEffect.ClampRating(key, value);
        });
        var mass = At(chassis, "car_mass_kg_target");
        if (mass.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) mass = At(chassis, "car_mass_kg_current");
        row["car_mass_kg"] = Math.Max(640, Required(mass, "mass"));
        return (row, unbounded);
    }

    static void ApplySeasonalUnderstanding(PartEffect effect, JsonElement raw, JsonElement[] designs, ChassisSnapshot chassis, double multiplier)
    {
        effect.Normalise();
        var total = effect.RatingEffects;
        var inherited = Numbers(At(raw, "inherited_rating_effects"));
        var step = Numbers(At(raw, "step_rating_effects"));
        if (inherited.Count == 0 && step.Count == 0) inherited = PreviousDesignEffects(designs, chassis);
        if (step.Count == 0)
            step = total.Keys.Union(inherited.Keys).ToDictionary(key => key, key => total.GetValueOrDefault(key) - inherited.GetValueOrDefault(key));
        // Existing development is retained in full; understanding scales only the new step.
        effect.RatingEffects = total.Keys.Union(inherited.Keys).Union(step.Keys)
            .ToDictionary(key => key, key => inherited.GetValueOrDefault(key) + step.GetValueOrDefault(key) * multiplier);
    }

    static Dictionary<string, double> PreviousDesignEffects(JsonElement[] designs, ChassisSnapshot chassis)
    {
        var identity = DesignIdentity(chassis.Id, "chassis:", ':');
        if (identity.Year == null || identity.Index == null) identity = DesignIdentity(chassis.Name, "C", '-');
        if (identity.Year == null || identity.Index is null or <= 1) return [];
        var previous = designs.FirstOrDefault(design => Number(At(design, "year")) == identity.Year && Number(At(design, "index")) == identity.Index - 1);
        var prior = new PartEffect(At(previous, "effect"));
        prior.Normalise();
        return prior.RatingEffects;
    }

    static void ApplyPotentialLimits(Dictionary<string, double> row, JsonElement chassis, JsonElement team)
    {
        foreach (string key in PartEffect.Ratings)
        {
            var potential = At(At(chassis, "potential"), key);
            if (potential.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) potential = At(At(At(team, "chassis_profile"), "potential"), key);
            row[key] = Math.Min(PartEffect.ClampRating(key, row[key]), PartEffect.ClampRating(key, Required(potential, $"potential {key}")));
        }
    }

    static void Penalise(PartEffect effect, double penalty)
    {
        foreach (string key in OldKeys) effect.RatingEffects[key] = Math.Min(effect.RatingEffects.GetValueOrDefault(key), -penalty);
    }

    static double Understanding(JsonElement source, string category, JsonElement item)
    {
        string name = Text(At(item, "name")); if (name.Length == 0) return 1;
        var info = At(At(At(At(source, "definitions"), "car_parts"), "parts"), category);
        double start = Clamp(Number(At(info, "understanding_start"), .5), 0, 1);
        double full = Math.Max(0, Math.Truncate(Number(At(info, "understanding_laps_to_full"), 250)));
        double used = Math.Max(0, Math.Truncate(Number(At(At(At(source, "teamInputs"), "part_understanding_laps"), name))));
        return full <= 0 ? 1 : Clamp(start + (1 - start) * used / full, 0, 1);
    }

    static double? Digits(ReadOnlySpan<char> value)
    {
        if (value.Length == 0) return null;
        foreach (char digit in value) if (digit < '0' || digit > '9') return null;
        return double.Parse(value, CultureInfo.InvariantCulture);
    }

    static (double? Year, double? Index) DesignIdentity(string value, string prefix, char separator)
    {
        if (!value.StartsWith(prefix, StringComparison.Ordinal)) return (null, null);
        int split = value.IndexOf(separator, prefix.Length);
        return split < 0 ? (null, null) : (Digits(value.AsSpan(prefix.Length, split - prefix.Length)), Digits(value.AsSpan(split + 1)));
    }

    static double? NamedYear(string name)
    {
        int split = name.IndexOf('-');
        return name.StartsWith('C') && split > 1 ? Digits(name.AsSpan(1, split - 1)) : null;
    }
}
