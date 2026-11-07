using System;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tpm.Setup.Core;

/// <summary>Authored fitted-unit and supplied-tyre cases, including reference-lap effects.</summary>
static class EquipmentChecks
{
    static void Near(double actual, double expected)
    { if (!double.IsFinite(actual) || Math.Abs(actual - expected) > 1e-9) throw new Exception($"Equipment: {actual} != {expected}"); }

    static JsonElement Element(JsonNode node) => JsonSerializer.SerializeToElement(node);

    public static void Run()
    {
        var source = SearchChecks.Source(); var driver = source["drivers"]![0]!;
        source["tyres"] = new JsonArray(source["tyres"]![0]!.DeepClone());
        var policy = source["activePolicies"]!["ers"]!; policy["ers_mode"] = "open";
        var unit = JsonNode.Parse("""{"category":"ers","item":{"name":"Fitted Example ERS","condition":1,"stats":{"capacity_mj":5.6,"deploy_mj_efficiency":0.8,"harvest_mj_efficiency":1.2,"acceleration_multiplier":1.75}}}""")!;
        driver["parts"]!.AsArray().Add(unit);
        double Bonus() => new ErsModel(Element(source)).Bonus(Element(driver));
        Near(Bonus(), 94.0625);
        // Charge limits a small battery, while condition belongs to failure simulation.
        unit["item"]!["stats"]!["capacity_mj"] = .25; Near(Bonus(), 10.9375);
        unit["item"]!["stats"]!["capacity_mj"] = 5.6;
        policy["acceleration_multiplier"] = 1; Near(Bonus(), 53.75); policy.AsObject().Remove("acceleration_multiplier");
        policy["ers_mode"] = "spec"; Near(Bonus(), 40);
        policy["ers_enabled"] = false; Near(Bonus(), 0);
        policy["ers_enabled"] = true; policy["ers_mode"] = "open";
        unit["item"]!["stats"]!.AsObject().Remove("capacity_mj");
        try { Bonus(); throw new Exception("Missing fitted ERS capacity was accepted."); }
        catch (ArgumentException error) when (error.Message.Contains("capacity_mj")) { }
        unit["item"]!["stats"]!["capacity_mj"] = 5.6;

        // A constant slow circuit has no extra deployment window to expand into.
        var track = source["track"]!.DeepClone();
        source["track"]!["micro_sectors"] = JsonNode.Parse("""[{"type":"low","length_pct":100}]""");
        Near(Bonus(), 70); source["track"] = track;

        // Both reference solving and candidate evaluation use the same equipment.
        (double Reference, double Lap) Grade()
        {
            var packet = new JsonObject { ["source"] = source.DeepClone(), ["payload"] = JsonNode.Parse("""{"seed":51}"""), ["mode"] = "grade", ["names"] = new JsonArray("Example Driver") };
            using var job = new SearchJob(packet.ToJsonString()); while (!job.PrepareStep()) { }
            var row = job.Drivers[0].Graded[0];
            return (row.Reference!.Lap, row.Lap);
        }
        var fitted = Grade(); policy["ers_enabled"] = false; var disabled = Grade();
        if (fitted.Reference >= disabled.Reference || fitted.Lap >= disabled.Lap) throw new Exception("Fitted ERS did not reach both references and candidates.");

        foreach (string axis in new[] { "lateral_grip", "longitudinal_grip" })
            source["tyreSupplier"]![axis]!["soft"] = 100;
        source["teamInputs"]!["tyre_contract"] = JsonNode.Parse("""{"type":"partner","bonus_grip_mult":1.0005}""");
        var supplied = Grade();
        if (supplied.Reference >= disabled.Reference || supplied.Lap >= disabled.Lap) throw new Exception("Saved tyre ratings did not reach references and candidates.");
        var supplier = TyreSupplier.Read(Element(source), "soft"); Near(supplier.ContractGrip, 1.0005);
        source["tyreSupplier"]!["temperature_tolerance"]!["soft"] = 1;
        var compoundData = Element(JsonNode.Parse("""{"lat_grip_base":1,"long_grip_base":1,"temp_window_c":[80,100],"wetness_states":[{"min_mm":0,"max_mm":5,"lat_mult":1,"long_mult":1}]}""")!);
        var tyre = TyreGrip.Compile(compoundData, 0, 30, 10, TyreSupplier.Read(Element(source), "soft"));
        Near(tyre.Evaluate(0, false).Lateral, 1.004245621875);
        Near(tyre.Evaluate(0, true).Lateral, 1.0055025);
        source["tyreSupplier"]!["lateral_grip"]!.AsObject().Remove("soft");
        try { TyreSupplier.Read(Element(source), "soft"); throw new Exception("Missing supplier rating was accepted."); }
        catch (ArgumentException error) when (error.Message.Contains("lateral_grip/soft")) { }
        Console.WriteLine("Fitted ERS and supplied-tyre checks passed.");
    }
}
