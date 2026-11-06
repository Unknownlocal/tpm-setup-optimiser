using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Turn fitted save equipment into the car and setup values used by simulation.</summary>
public static class SavedCar
{
    // Fixed car values precede the FormulaSetup model in each output record.
    public const int ValueLength = 14, RecordLength = ValueLength + FormulaSetup.ModelLength;

    public static double[] Build(string json)
    {
        using var document = JsonDocument.Parse(json);
        return Build(document.RootElement);
    }

    public static double[] Build(JsonElement source)
    {
        var drivers = Items(At(source, "drivers")).ToArray();
        if (drivers.Length == 0) throw new ArgumentException("A saved car needs a driver entry.");
        var result = new List<double>(1 + RecordLength * drivers.Length) { drivers.Length };
        foreach (var driver in drivers)
        {
            var parts = Items(At(driver, "parts")).ToArray();
            var (row, chassis) = ChassisRatings.Build(source, driver);
            double aero = row["aero_efficiency_rating"];
            ApplySuppliers(row, source, parts);
            int activeAero = Level(parts, "active_aero");
            row["straight"] += activeAero;
            var engine = Part(parts, "engine");
            result.AddRange([row["slow"], row["med"], row["high"], row["straight"], row["team_pace"], row["acceleration"], row["braking"], row["car_mass_kg"], aero,
                EnginePower(engine, At(At(At(source, "definitions"), "engines"), "unit_rules")), Math.Max(50, Required(At(engine, "mass_kg"), "engine mass")), activeAero, Level(parts, "advanced_tpms") == 5 ? 1 : 0, row["tyre_management"]]);
            var concept = CarConcept(source, chassis);
            result.AddRange(FormulaSetup.Compile(At(source, "setupDefinitions"), aero, Required(At(concept, "balance"), "concept balance"), Required(At(concept, "traction"), "concept traction"), Required(At(At(driver, "preferences"), "balance_preference"), "driver balance preference")));
        }
        return result.ToArray();
    }

    static JsonElement Part(JsonElement[] parts, string category) =>
        At(parts.FirstOrDefault(part => Text(At(part, "category")) == category), "item");

    static int Level(JsonElement[] parts, string key) =>
        (int)Clamp(Math.Truncate(Number(At(Part(parts, key), "level"))), 0, 5);

    static void ApplySuppliers(Dictionary<string, double> row, JsonElement source, JsonElement[] parts)
    {
        var contributions = new Dictionary<string, double>();
        foreach (var part in parts.Where(part => Has(part, "supplierDefinition")))
        {
            var definition = At(part, "supplierDefinition");
            string category = Text(At(part, "category"));
            // Supplier state is clamped before the installed item's extra bonus is applied.
            double supplierRating = Clamp(Number(At(definition, "pace_rating"), 50) + Number(At(At(part, "supplierState"), "pace_offset")), 1, 100);
            double rating = Clamp(supplierRating + Number(At(At(part, "item"), "pace_bonus")), 1, 100);
            double scale = rating >= 50 ? (rating - 50) / 50 : -(50 - rating) / 49;
            (string, double)[] mapping = category switch
            {
                "fuel" => [("acceleration", 3)], "gearbox" => [("acceleration", 2), ("straight", 2)],
                "suspension" => [("slow", 5)], "brakes" => [("braking", 5)], "ecu" => [("team_pace", 1)],
                _ => throw new ArgumentException($"Unsupported supplier category {category}."),
            };
            foreach (var (key, cap) in mapping) contributions[key] = contributions.GetValueOrDefault(key) + scale * cap;
            if (category == "fuel" && MatchesPreferredEngine(source, definition)) contributions["acceleration"] += 1;
        }
        // Chassis potential has already been applied. Supplier gains are added afterwards.
        foreach (string key in PartEffect.Zones.Concat(["acceleration", "braking", "team_pace"]))
            row[key] = Clamp(row[key], 0, 100) - 50 + contributions.GetValueOrDefault(key);
    }

    static bool MatchesPreferredEngine(JsonElement source, JsonElement supplier)
    {
        string preferred = Signature(Text(At(supplier, "preferred_engine")));
        return preferred.Length > 0 && Items(At(At(source, "teamInputs"), "engineSignatures")).Any(value => Signature(Text(value)) == preferred);
    }

    static JsonElement CarConcept(JsonElement source, JsonElement chassis)
    {
        var concepts = At(At(source, "definitions"), "car_concepts");
        string key = Text(At(chassis, "car_concept"));
        if (key.Length == 0) key = Text(At(concepts, "default"));
        if (key.Length == 0) key = "balanced";
        var concept = At(At(concepts, "concepts"), key);
        return concept.ValueKind == JsonValueKind.Object ? concept : throw new ArgumentException($"Unsupported fitted car concept: {key}.");
    }

    static string Signature(string name) => new(name.ToLowerInvariant().Where(c => c is >= 'a' and <= 'z' or >= '0' and <= '9').ToArray());

    static double EnginePower(JsonElement engine, JsonElement rules)
    {
        double quantum = Math.Max(.01, OrNumber(At(rules, "power_rating_wear_quantum"), .25));
        double maxLoss = Number(At(rules, "max_power_rating_loss_at_zero_condition"), 6.25);
        bool precise = Number(At(engine, "power_precision_version")) >= 2;
        double Worn(double rating, double condition)
        {
            double loss = (1 - Clamp(condition, 0, 100) / 100) * maxLoss;
            return precise ? rating - Math.Round(loss / quantum, MidpointRounding.ToEven) * quantum : Math.Round((rating - loss) / quantum, MidpointRounding.ToEven) * quantum;
        }
        double first = Clamp(Worn(Clamp(OrNumber(At(engine, "power_rating"), 50), 1, 100), Number(At(engine, "condition"), 100)), 1, 100);
        // Both wear stages are observable; stage two treats zero condition as missing.
        return Clamp(Worn(first, OrNumber(At(engine, "condition"), 100)), 0, 100);
    }
}
