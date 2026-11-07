using System;
using System.Text.Json;
using Tpm.Setup.Core;

/// <summary>Authored weather/tyre situations and independent Python random reference values.</summary>
static class ConditionsChecks
{
    static void Near(double actual, double expected)
    {
        if (!double.IsFinite(actual) || Math.Abs(actual - expected) > 1e-12) throw new Exception($"Conditions: {actual} != {expected}");
    }

    public static void Run()
    {
        using var source = JsonDocument.Parse("""
        {"sessionOptions":{"laps":5},"track":{"lap_modifier":0.5},"trackLapModifiersEnabled":true,
         "weather":{"temperature_c":null,"wetness_mm":0.5},"definitions":{"constants":{}}}
        """);
        var profile = SessionTemperature.Profile(source.RootElement, 51);
        if (profile.Length != 2 || Array.Exists(profile, value => value < 10 || value > 40)) throw new Exception("Session curve bounds or half-tie lap count changed.");
        var manual = SessionTemperature.Resolve("{\"weather\":{\"temperature_c\":30.625},\"sessionOptions\":{\"laps\":10001}}", 51);
        Near(manual[0], 30.625); Near(manual[1], 0);
        try
        {
            SessionTemperature.Resolve("{\"weather\":{\"temperature_c\":null},\"sessionOptions\":{\"laps\":10001}}", 51);
            throw new Exception("Oversized session curve was accepted.");
        }
        catch (ArgumentException error) when (error.Message.Contains("10,000")) { }

        using var compound = JsonDocument.Parse("""
        {"lat_grip_base":1,"long_grip_base":0.9,"temp_window_c":[80,100],"wetness_states":[
          {"min_mm":0,"max_mm":1,"lat_mult":1,"long_mult":1},
          {"min_mm":1,"max_mm":5,"lat_mult":0.8,"long_mult":0.7}]}
        """);
        var supplier = new TyreSupplier(50, 50, 50, 1);
        var dry = TyreGrip.Compile(compound.RootElement, 1, 30, 10, supplier).Evaluate(0, false);
        Near(dry.Temperature, 100); Near(dry.Lateral, 1); Near(dry.Longitudinal, .9);
        var wetModel = TyreGrip.Compile(compound.RootElement, 1.001, 50, 10, supplier);
        var wet = wetModel.Evaluate(5, false);
        Near(wet.Temperature, 115); Near(wet.Lateral, .797); Near(wet.Longitudinal, .6276375);
        Near(wetModel.Evaluate(5, true).Lateral, .8);

        using var loop = JsonDocument.Parse("""
        {"trackId":"loop","testing":false,"sessionOptions":{},"definitions":{"config":{"wind":{"starting_speed_kmh":[36,36]}}},
         "track":{"points":[[0,0],[100,0],[100,100],[0,100]],"micro_sectors":[
          {"type":"high","length_pct":25},{"type":"high","length_pct":25},
          {"type":"high","length_pct":25},{"type":"high","length_pct":25}]}}
        """);
        var wind = WindModel.Build(loop.RootElement, 51);
        Near(wind.Speed, 36); Near(wind.Direction, 145.67479187298034);
        if (wind.Sectors.Length != 4) throw new Exception("Square circuit wind subdivision changed.");
        Near(wind.Sectors[0].Tailwind, 5.638894485683556); Near(wind.Sectors[1].Tailwind, 8.258502829165078);
        Near(wind.Sectors[2].Tailwind, -5.638894485683556); Near(wind.Sectors[3].Tailwind, -8.258502829165078);

        using var bent = JsonDocument.Parse("""
        {"trackId":"loop","definitions":{"config":{"wind":{"starting_speed_kmh":[36,36]}}},
         "track":{"points":[[0,0],[100,0],[100,0],[100,100],[0,100]],
                  "micro_sectors":[{"type":"high","length_pct":80}]}}
        """);
        var split = WindModel.Build(bent.RootElement, 51);
        if (split.Sectors.Length != 4) throw new Exception("A bent sector needs four wind samples.");
        for (int i = 0; i < split.Sectors.Length; i++)
        {
            Near(split.Sectors[i].LengthPercent, 25); Near(split.Sectors[i].Source, 0);
            Near(split.Sectors[i].Tailwind, wind.Sectors[i].Tailwind);
            Near(split.Sectors[i].CornerLoss, wind.Sectors[i].CornerLoss);
        }

        var random = new GameRandom(51);
        Near(random.Random(), .243517762709337);
        // A long stream crosses multiple MT state refreshes without reseeding.
        random = new GameRandom(51); uint word = 0;
        for (int i = 0; i <= 4096; i++) word = random.NextWord();
        Near(word, 3539689165);
        Console.WriteLine("Weather, tyre and random checks passed.");
    }
}
