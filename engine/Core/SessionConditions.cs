using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Compile shared weather, driver variability and tyre models once per scenario.</summary>
public static class SessionConditions
{
    public static double[] Build(string json, double seed)
    {
        int checkedSeed = SessionTemperature.Seed(seed); using var document = JsonDocument.Parse(json);
        return Build(document.RootElement, checkedSeed);
    }

    public static double[] Build(JsonElement source, int checkedSeed, string? trackId = null, bool? testing = null)
    {
        var constants = At(At(source, "definitions"), "constants");
        var drivers = Items(At(source, "drivers")).ToArray(); var tyres = Items(At(source, "tyres")).ToArray();
        var wind = WindModel.Build(source, checkedSeed, trackId, testing);
        double level = Clamp(Math.Truncate(Number(At(At(source, "sessionOptions"), "variability_level"), 1)), Number(At(constants, "WEEKEND_CORNERING_VARIABILITY_LEVEL_MIN"), 1), Number(At(constants, "WEEKEND_CORNERING_VARIABILITY_LEVEL_MAX"), 10));
        double span = level * Number(At(constants, "WEEKEND_CORNERING_VARIABILITY_KMH_PER_LEVEL"), .25);
        var random = new GameRandom((ulong)(checkedSeed + 977));
        var variations = new Dictionary<string, double>();
        foreach (var driver in drivers.OrderBy(driver => Text(At(driver, "name")), StringComparer.Ordinal)) variations[Text(At(driver, "name"))] = random.Uniform(-span, span);
        var staff = Items(At(source, "dynamicsStaff")).FirstOrDefault();
        double morale = Clamp(50 + Items(At(staff, "morale_effects")).Sum(effect => Number(At(effect, "amount"))), 0, 100);
        var rawSkill = At(At(staff, "skills"), "tire_temp");
        double skill = Clamp(Math.Truncate(Number(rawSkill, Number(At(staff, "skill"), 1)) + (morale - 50) / 50 * 2 + .5), 1, 20);
        // Header, driver variations in source order, five-value tyre models, then wind rows.
        var result = new List<double> { 1, wind.Speed, wind.Direction, wind.BrakeCap, wind.Sectors.Count / 4, skill, drivers.Length, tyres.Length };
        foreach (var driver in drivers) result.Add(variations[Text(At(driver, "name"))]);
        var weather = At(source, "weather"); double water = Number(At(weather, "wetness_mm"));
        double ambient = Required(At(weather, "temperature_c"), "ambient temperature");
        foreach (var tyre in tyres) result.AddRange(TyreGrip.Compile(tyre, water, ambient, skill));
        result.AddRange(wind.Sectors);
        return result.ToArray();
    }
}
