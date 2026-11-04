using System;
using Tpm.Setup.Core;

/// <summary>Authored equipment and setup cases; no game or user files are needed.</summary>
static class SavedCarChecks
{
    internal const string Source = """
        {
          "calendarYear":2029,
          "teamInputs":{"engineSignatures":["Example Motors"],"part_understanding_laps":{"FW-A":50}},
          "definitions":{
            "constants":{},"engines":{"unit_rules":{}},
            "car_parts":{"order":["chassis","front_wing"],"parts":{"chassis":{},"front_wing":{"understanding_start":0.5,"understanding_laps_to_full":100}}},
            "car_concepts":{"default":"balanced","concepts":{"balanced":{"balance":50,"traction":50}}}
          },
          "setupDefinitions":{
            "wing_levels":{"min_level":0,"neutral_level":10,"max_level":20,"diminishing_returns":{"enabled":false},
              "front_per_click_kmh":{"slow":1,"med":0,"high":0,"straight":-0.5},"rear_per_click_kmh":{"slow":0,"med":0,"high":1,"straight":-1}},
            "tyre_pressures":{
              "front":{"min_psi":20,"neutral_psi":21,"max_psi":22,"min_effects":{"slow":1,"accel_ms2":0.2,"target_temp_delta_c":-2},"max_effects":{}},
              "rear":{"min_psi":20,"neutral_psi":21,"max_psi":22,"min_effects":{},"max_effects":{"slow":-1,"accel_ms2":-0.3,"target_temp_delta_c":3}}},
            "suspension_setup":{"min_level":1,"neutral_level":3,"max_level":5,"min_effects":{"med":2},"max_effects":{}}
          },
          "drivers":[{"name":"Example Driver","preferences":{"balance_preference":65},"parts":[
            {"category":"chassis","item":{"name":"C2029-1","effect":{
              "baseline_targets":{"slow":60,"med":60,"high":60,"straight":60,"team_pace":60,"acceleration":60,"braking":60,"tyre_management":60,"aero_efficiency_rating":80},
              "potential":{"slow":70,"med":90,"high":90,"straight":90,"team_pace":90,"acceleration":90,"braking":90,"tyre_management":90,"aero_efficiency_rating":70},"car_mass_kg_target":660}}},
            {"category":"front_wing","item":{"name":"FW-A","effect":{"rating_effects":{"slow":20,"straight":-4}}}},
            {"category":"engine","item":{"power_rating":63.37,"condition":50,"power_precision_version":2,"mass_kg":120}},
            {"category":"fuel","item":{},"supplierDefinition":{"pace_rating":50,"preferred_engine":"Example Motors"},"supplierState":{}},
            {"category":"active_aero","item":{"level":2}}
          ]}]
        }
        """;

    public static void Run()
    {
        static void Near(double value, double expected)
        {
            if (!double.IsFinite(value) || Math.Abs(value - expected) > 1e-9) throw new Exception($"Saved car: {value} != {expected}");
        }
        var car = SavedCar.Build(Source);
        // Understanding is applied before potential caps; suppliers follow the caps.
        Near(car[1], 20); Near(car[4], 9); Near(car[6], 11); Near(car[9], 70); Near(car[10], 57.37);
        var model = new FormulaSetup(car.AsSpan(1 + SavedCar.ValueLength));
        var setup = model.Evaluate([20, 0, 20, 22, 1]);
        Near(setup.Slow, 9.775); Near(setup.Med, 1.775); Near(setup.High, -10.225); Near(setup.Straight, 5);
        Near(setup.Acceleration, -.1); Near(setup.TemperatureDelta, 1); Near(setup.Balance, 80); Near(setup.Traction, 30);
        // Chassis aero efficiency reduces the wing drag penalty, not positive gains.
        Near(model.Evaluate([20, 20, 21, 21, 3]).Straight, -12);
        Near(SavedCar.Build(Source.Replace("\"condition\":50", "\"condition\":0"))[10], 57.12);
        try
        {
            SavedCar.Build(Source.Replace("\"potential\":", "\"missing_potential\":"));
            throw new Exception("Missing chassis potential was accepted.");
        }
        catch (ArgumentException error) when (error.Message.Contains("potential")) { }
        Console.WriteLine("Saved-car and setup checks passed.");
    }
}
