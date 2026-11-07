using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Shared wind, source-order driver variability and compiled tyres for one scenario.</summary>
public sealed record SessionConditions(WindModel Wind, double[] CornerVariations, TyreGrip[] Tyres, double[] ErsBonuses)
{
    public static SessionConditions Build(JsonElement source, int seed, string? trackId = null, bool? testing = null)
    {
        var constants = At(At(source, "definitions"), "constants");
        var drivers = Items(At(source, "drivers")).ToArray();
        var wind = WindModel.Build(source, seed, trackId, testing);
        double level = Clamp(Math.Truncate(Number(At(At(source, "sessionOptions"), "variability_level"), 1)), Number(At(constants, "WEEKEND_CORNERING_VARIABILITY_LEVEL_MIN"), 1), Number(At(constants, "WEEKEND_CORNERING_VARIABILITY_LEVEL_MAX"), 10));
        double span = level * Number(At(constants, "WEEKEND_CORNERING_VARIABILITY_KMH_PER_LEVEL"), .25);
        var random = new GameRandom((ulong)(seed + 977));
        var variations = new Dictionary<string, double>();
        // Draw in name order, then restore save order so entries retain the game's seeded variation.
        foreach (var driver in drivers.OrderBy(driver => Text(At(driver, "name")), StringComparer.Ordinal))
            variations[Text(At(driver, "name"))] = random.Uniform(-span, span);

        var staff = Items(At(source, "dynamicsStaff")).FirstOrDefault();
        double morale = Clamp(50 + Items(At(staff, "morale_effects")).Sum(effect => Number(At(effect, "amount"))), 0, 100);
        var rawSkill = At(At(staff, "skills"), "tire_temp");
        double skill = Clamp(Math.Truncate(Number(rawSkill, Number(At(staff, "skill"), 1)) + (morale - 50) / 50 * 2 + .5), 1, 20);
        var weather = At(source, "weather");
        double water = Number(At(weather, "wetness_mm"));
        double ambient = Required(At(weather, "temperature_c"), "ambient temperature");
        var tyres = Items(At(source, "tyres")).Select(tyre => TyreGrip.Compile(tyre, water, ambient, skill, TyreSupplier.Read(source, Text(At(tyre, "name"))))).ToArray();
        var ers = new ErsModel(source);
        return new(wind, drivers.Select(driver => variations[Text(At(driver, "name"))]).ToArray(), tyres, drivers.Select(ers.Bonus).ToArray());
    }
}
