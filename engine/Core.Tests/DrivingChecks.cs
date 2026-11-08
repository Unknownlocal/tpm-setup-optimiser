using System;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tpm.Setup.Core;

/// <summary>Driving choices must reach reference and candidate laps without changing tyre targets.</summary>
static class DrivingChecks
{
    static void Near(double actual, double expected)
    { if (!double.IsFinite(actual) || Math.Abs(actual - expected) > 1e-9) throw new Exception($"Driving settings: {actual} != {expected}"); }

    public static void Run()
    {
        var source = SearchChecks.Source();
        DriverScenario Scenario()
        {
            var input = JsonSerializer.SerializeToElement(source);
            var conditions = SessionConditions.Build(input, 51);
            return new(input, input.GetProperty("drivers")[0], 0, SavedCar.Build(input), conditions,
                new MotionModel(input.GetProperty("track"), input.GetProperty("activePolicies").GetProperty("car"), conditions.Wind));
        }
        LapResult Lap() { var scenario = Scenario(); return scenario.Evaluate(0, scenario.Initial, true); }
        double Reference()
        {
            var solver = new ReferenceSolver(Scenario(), 0); foreach (int slice in solver.Solve()) { }
            return solver.Result!.Lap;
        }
        var baseline = Lap(); double reference = Reference();
        source["driving"] = JsonNode.Parse("""{"fuel_kg":15,"pace":"neutral","engine":"medium"}""");
        Near(Lap().Lap, baseline.Lap); Near(Reference(), reference);
        var driving = source["driving"]!;
        driving["fuel_kg"] = 75;
        var heavy = Lap(); Near(heavy.Inputs!.FuelMass, 75);
        if (heavy.Lap <= baseline.Lap || Reference() <= reference) throw new Exception("Fuel load did not reach both candidate and reference laps.");
        driving["fuel_kg"] = 15; driving["pace"] = "conserve"; driving["engine"] = "low";
        var conservative = Lap();
        Near(conservative.Inputs!.DriverCorner, baseline.Inputs!.DriverCorner - .4);
        Near(conservative.Inputs.EnginePower, baseline.Inputs.EnginePower - 2);
        Near(conservative.Temperature, baseline.Temperature);
        if (conservative.Lap <= baseline.Lap || Reference() <= reference) throw new Exception("Driving modes did not reach both candidate and reference laps.");

        // Apply the mode after fitted-engine wear, then clamp the effective rating.
        source["drivers"]![0]!["parts"]![2]!["item"]!["power_rating"] = 100;
        source["drivers"]![0]!["parts"]![2]!["item"]!["condition"] = 100;
        driving["fuel_kg"] = 0; driving["pace"] = "neutral"; driving["engine"] = "high";
        var high = Lap(); Near(high.Inputs!.FuelMass, 0); Near(high.Inputs.EnginePower, 100);
        Near(high.Inputs.DriverCorner, baseline.Inputs.DriverCorner);
        foreach (string invalid in new[] { """{"fuel_kg":-1,"pace":"push","engine":"medium"}""", """{"fuel_kg":15,"pace":"unknown","engine":"medium"}""", """{"fuel_kg":15,"pace":"push","engine":"unknown"}""" })
        {
            source["driving"] = JsonNode.Parse(invalid);
            try { Lap(); throw new Exception("Invalid driving settings were accepted."); }
            catch (ArgumentException) { }
        }
        Console.WriteLine("Fuel, pace and engine-mode checks passed.");
    }
}
