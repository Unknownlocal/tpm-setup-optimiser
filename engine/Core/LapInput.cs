using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Tpm.Setup.Core;

/// <summary>One flying lap's prepared ratings, masses and grip. No save objects are retained.</summary>
public sealed record LapInput(double Slow, double Med, double High, double Corner, double Straight, double TeamPace,
    double Braking, double Acceleration, double EnginePower, double CarMass, double EngineMass, double FuelMass,
    double ReferenceMass, double DriverCorner, double DriverBraking, double Lateral, double Longitudinal, double Aero)
{
    static readonly string[] Fields = ["slow_rating_points", "med_rating_points", "high_rating_points", "corner_rating_points", "straight_rating_points", "team_pace_rating_points", "engine_pace_rating_points", "braking_rating_points", "acceleration_rating_points", "engine_power_rating", "car_mass_kg", "engine_mass_kg", "fuel_mass_kg", "mass_ref_kg", "driver_cornering_kmh_bonus", "driver_braking_ms2_bonus", "tyre_lat_mult", "tyre_long_mult", "oval_driver_discipline_rating", "oval_driver_control_rating", "wind_aero_efficiency_rating", "oval_trait_corner_kmh_delta", "oval_trait_brake_mult", "drs_extra_speed_kmh"];

    public static double Need(JsonElement value, string label)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out double number) || !double.IsFinite(number))
            throw new ArgumentException($"Invalid lap input: {label}.");
        return number;
    }

    public static LapInput Read(JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Object || raw.EnumerateObject().Any(p => !Fields.Contains(p.Name) && p.Name != "drs_speed_windows"))
            throw new ArgumentException("Unknown prepared lap-input field.");
        var values = Fields.ToDictionary(key => key, key => Need(JsonValues.At(raw, key), key));
        foreach (var (key, expected) in new[] { ("drs_extra_speed_kmh", 0.0), ("oval_trait_corner_kmh_delta", 0.0), ("oval_trait_brake_mult", 1.0), ("oval_driver_discipline_rating", 10.0), ("oval_driver_control_rating", 10.0) })
            if (values[key] != expected) throw new ArgumentException("DRS and oval effects are outside this lap-engine slice.");
        var windows = JsonValues.At(raw, "drs_speed_windows");
        if (windows.ValueKind != JsonValueKind.Array || windows.GetArrayLength() != 0) throw new ArgumentException("DRS windows are outside this lap-engine slice.");
        double V(string key) => values[key];
        return new(V("slow_rating_points"), V("med_rating_points"), V("high_rating_points"), V("corner_rating_points"), V("straight_rating_points"), V("team_pace_rating_points"),
            V("braking_rating_points"), V("acceleration_rating_points"), V("engine_power_rating"), V("car_mass_kg"), V("engine_mass_kg"), V("fuel_mass_kg"), V("mass_ref_kg"),
            V("driver_cornering_kmh_bonus"), V("driver_braking_ms2_bonus"), V("tyre_lat_mult"), V("tyre_long_mult"), V("wind_aero_efficiency_rating"));
    }

    public void Write(Utf8JsonWriter writer)
    {
        double[] values = [Slow, Med, High, Corner, Straight, TeamPace, 0, Braking, Acceleration, EnginePower, CarMass, EngineMass, FuelMass, ReferenceMass, DriverCorner, DriverBraking, Lateral, Longitudinal, 10, 10, Aero, 0, 1, 0];
        writer.WriteStartObject();
        for (int i = 0; i < Fields.Length; i++) writer.WriteNumber(Fields[i], values[i]);
        writer.WriteStartArray("drs_speed_windows"); writer.WriteEndArray(); writer.WriteEndObject();
    }
}
