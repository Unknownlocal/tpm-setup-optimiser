using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Turn the fitted save projection into immutable numerical car/setup models.</summary>
public static class SavedCar
{
    // Fixed car values precede the FormulaSetup model in each output record.
    public const int ValueLength = 14, RecordLength = ValueLength + FormulaSetup.ModelLength;

    public static double[] Build(string json)
    {
        using var document = JsonDocument.Parse(json);
        var source = document.RootElement;
        var drivers = Items(At(source, "drivers")).ToArray();
        if (drivers.Length == 0) throw new ArgumentException("A saved car needs a driver entry.");
        var result = new List<double>(1 + RecordLength * drivers.Length) { drivers.Length };
        foreach (var driver in drivers)
        {
            var parts = Items(At(driver, "parts")).ToArray();
            JsonElement Part(string category) => At(parts.FirstOrDefault(part => Text(At(part, "category")) == category), "item");
            int Level(string key) => key is "active_suspension" or "traction_control" or "abs" ? 0 : (int)Clamp(Math.Truncate(Number(At(Part(key), "level"))), 0, 5);
            var (row, chassis) = ChassisRatings.Build(source, driver);
            var supplier = new Dictionary<string, double>();
            foreach (var part in parts.Where(part => Has(part, "supplierDefinition")))
            {
                var definition = At(part, "supplierDefinition"); var item = At(part, "item");
                string category = Text(At(part, "category"));
                double rating = Clamp(Clamp(Number(At(definition, "pace_rating"), 50) + Number(At(At(part, "supplierState"), "pace_offset")), 1, 100) + Number(At(item, "pace_bonus")), 1, 100);
                double scale = rating >= 50 ? (rating - 50) / 50 : -(50 - rating) / 49;
                (string, double)[] mapping = category switch
                {
                    "fuel" => [("acceleration", 3)], "gearbox" => [("acceleration", 2), ("straight", 2)],
                    "suspension" => [("slow", 5)], "brakes" => [("braking", 5)], "ecu" => [("team_pace", 1)],
                    _ => throw new ArgumentException($"Unsupported supplier category {category}."),
                };
                foreach (var (key, cap) in mapping) supplier[key] = supplier.GetValueOrDefault(key) + scale * cap;
                if (category == "fuel")
                {
                    string preferred = Signature(Text(At(definition, "preferred_engine")));
                    if (preferred.Length > 0 && Items(At(At(source, "teamInputs"), "engineSignatures")).Any(value => Signature(Text(value)) == preferred)) supplier["acceleration"] += 1;
                }
            }
            double aero = row["aero_efficiency_rating"];
            foreach (string key in PartEffect.Zones.Concat(["acceleration", "braking", "team_pace"]))
                row[key] = Clamp(row[key], 0, 100) - 50 + supplier.GetValueOrDefault(key);
            row["straight"] += Level("active_aero");
            var engine = Part("engine");
            result.AddRange([row["slow"], row["med"], row["high"], row["straight"], row["team_pace"], row["acceleration"], row["braking"], row["car_mass_kg"], aero,
                EnginePower(engine, At(At(At(source, "definitions"), "engines"), "unit_rules")), Math.Max(50, Required(At(engine, "mass_kg"), "engine mass")), Level("active_aero"), Level("advanced_tpms") == 5 ? 1 : 0, row["tyre_management"]]);
            var concepts = At(At(source, "definitions"), "car_concepts");
            string conceptKey = Text(At(chassis, "car_concept"));
            if (conceptKey.Length == 0) conceptKey = Text(At(concepts, "default"));
            if (conceptKey.Length == 0) conceptKey = "balanced";
            var concept = At(At(concepts, "concepts"), conceptKey);
            if (concept.ValueKind != JsonValueKind.Object) throw new ArgumentException($"Unsupported fitted car concept: {conceptKey}.");
            result.AddRange(FormulaSetup.Compile(At(source, "setupDefinitions"), aero, Required(At(concept, "balance"), "concept balance"), Required(At(concept, "traction"), "concept traction"), Required(At(At(driver, "preferences"), "balance_preference"), "driver balance preference")));
        }
        return result.ToArray();
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
