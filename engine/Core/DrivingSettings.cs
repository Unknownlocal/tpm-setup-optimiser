using System;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Constant fuel and the game's immediate driving-mode effects for a projected lap.</summary>
public sealed record DrivingSettings(double FuelKg, double CorneringBonus, double EnginePowerDelta)
{
    public static DrivingSettings Read(JsonElement source)
    {
        var raw = At(source, "driving");
        // Missing controls use medium (neutral) pace and medium engine, as on the form.
        if (raw.ValueKind == JsonValueKind.Undefined) return new(15, 0, 0);
        if (raw.ValueKind != JsonValueKind.Object) throw new ArgumentException("Invalid driving settings.");
        double fuel = Required(At(raw, "fuel_kg"), "fuel load");
        if (fuel < 0) throw new ArgumentException("Fuel load must be zero or greater.");
        double cornering = Text(At(raw, "pace")) switch
        {
            "conserve" => -.4, "neutral" => 0, "push" => .4,
            _ => throw new ArgumentException("Choose conserve, neutral or push pace."),
        };
        double power = Text(At(raw, "engine")) switch
        {
            "low" => -2, "medium" => 0, "high" => 2,
            _ => throw new ArgumentException("Choose low, medium or high engine mode."),
        };
        return new(fuel, cornering, power);
    }
}
