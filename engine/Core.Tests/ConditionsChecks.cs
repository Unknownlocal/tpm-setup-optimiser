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
        var dry = TyreGrip.Evaluate(TyreGrip.Compile(compound.RootElement, 1, 30, 10), 0, false);
        Near(dry.Temperature, 100); Near(dry.Lateral, 1); Near(dry.Longitudinal, .9);
        var wetModel = TyreGrip.Compile(compound.RootElement, 1.001, 50, 10);
        var wet = TyreGrip.Evaluate(wetModel, 5, false);
        Near(wet.Temperature, 115); Near(wet.Lateral, .797); Near(wet.Longitudinal, .6276375);
        Near(TyreGrip.Evaluate(wetModel, 5, true).Lateral, .8);

        using var loop = JsonDocument.Parse("""
        {"trackId":"loop","testing":false,"sessionOptions":{},"definitions":{"config":{"wind":{"starting_speed_kmh":[36,36]}}},
         "track":{"points":[[0,0],[100,0],[100,100],[0,100]],"micro_sectors":[
          {"type":"high","length_pct":25},{"type":"high","length_pct":25},
          {"type":"high","length_pct":25},{"type":"high","length_pct":25}]}}
        """);
        var wind = WindModel.Build(loop.RootElement, 51);
        Near(wind.Speed, 36); Near(wind.Direction, 145.67479187298034);
        if (wind.Sectors.Count != 16) throw new Exception("Square circuit wind subdivision changed.");
        Near(wind.Sectors[3], 5.638894485683556); Near(wind.Sectors[7], 8.258502829165078);
        Near(wind.Sectors[11], -5.638894485683556); Near(wind.Sectors[15], -8.258502829165078);

        var random = new GameRandom(51);
        Near(random.Random(), .243517762709337);
        // Continuation must cross word-buffer boundaries without reseeding the stream.
        var first = GameRandom.Words("51", []);
        var second = GameRandom.Words("51", first.AsSpan(0, GameRandom.StateLength));
        Near(first[GameRandom.StateLength], 1045900815);
        Near(second[GameRandom.StateLength], 3539689165);
        Console.WriteLine("Weather, tyre and random checks passed.");
    }
}
