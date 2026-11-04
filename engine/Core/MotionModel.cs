using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Compile track geometry once, then turn ratings into speed/braking limits.
/// A worker evaluates laps sequentially; temporary arrays never escape into results.</summary>
public sealed class MotionModel
{
    enum SectorType { Low, Med, High, Corner, Straight, Braking, Acceleration }
    readonly record struct Sector(SectorType Type, double Percent, double Target, double Low, double High, double RatingFactor, double PaceFactor);
    readonly record struct Transition(int Index, int Before, int After);
    readonly Sector[] micro;
    readonly Transition[] transitions;
    readonly double length, acceleration, braking, dragMultiplier;
    readonly double[] distances, losses, tails;
    readonly int[]? sources;
    readonly double brakeCap;
    readonly double[] targets, caps, brakes;
    readonly LapIntegrator integrator;

    static (double Low, double High) Bounds(SectorType type) => type switch
    {
        SectorType.Low => (40, 220), SectorType.Med => (70, 280), SectorType.High => (95, 340), SectorType.Corner => (40, 400), SectorType.Straight => (120, 420), _ => (0, 0),
    };

    static Sector[] Sectors(JsonElement raw, bool targets)
    {
        if (raw.ValueKind != JsonValueKind.Array || raw.GetArrayLength() is < 1 or > 2048) throw new ArgumentException("Lap geometry needs 1–2,048 sectors.");
        var result = raw.EnumerateArray().Select(sector =>
        {
            var type = Text(At(sector, "type")) switch
            {
                "low" => SectorType.Low, "med" => SectorType.Med, "high" => SectorType.High, "corner" => SectorType.Corner,
                "straight" => SectorType.Straight, "braking" => SectorType.Braking, "acceleration" => SectorType.Acceleration,
                _ => throw new ArgumentException("Unsupported lap sector type."),
            };
            var bounds = Bounds(type);
            double percent = LapInput.Need(At(sector, "length_pct"), "sector length");
            if (percent <= 0 || percent > 100) throw new ArgumentException("Invalid sector length.");
            double target = targets && bounds.High != 0 ? LapInput.Need(At(sector, "target_speed_kmh"), "target speed") : 0;
            if (targets && bounds.High != 0 && target <= 0) throw new ArgumentException("Invalid target speed.");
            double rating = type switch { SectorType.Low => .084375, SectorType.Med => .09375, SectorType.High or SectorType.Corner => .15, _ => 0 };
            double pace = type switch { SectorType.Low => .045, SectorType.Med => .055, _ => .07 };
            return new Sector(type, percent, targets && bounds.High != 0 ? Clamp(target, bounds.Low, bounds.High) : 0, bounds.Low, bounds.High, rating, pace);
        }).ToArray();
        double total = result.Sum(sector => sector.Percent), scale = targets ? 100 / total : 1;
        if (!double.IsFinite(scale) || scale <= 0 || !targets && Math.Abs(total - 100) > 1e-8) throw new ArgumentException("Invalid lap geometry coverage.");
        for (int i = 0; i < result.Length; i++)
        {
            result[i] = result[i] with { Percent = result[i].Percent * scale };
            if (result[i].Percent <= 1e-9) throw new ArgumentException("A sector is too short for this lap-engine slice.");
        }
        return result;
    }

    public MotionModel(JsonElement track, JsonElement profile, WindModel? projectedWind = null, JsonElement wind = default)
    {
        if (profile.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Object)) throw new ArgumentException("Invalid prepared car profile.");
        length = LapInput.Need(At(track, "length_km"), "track length");
        if (length < .01 || length > 25) throw new ArgumentException("Invalid track length.");
        length *= 1000;
        double Multiplier(string key)
        {
            double value = Number(At(profile, key), 1);
            if (value < .01 || value > 4) throw new ArgumentException($"Invalid car profile: {key}.");
            return value;
        }
        double corner = Multiplier("corner_speed_multiplier"); acceleration = Multiplier("acceleration_multiplier"); braking = Multiplier("braking_multiplier"); dragMultiplier = Multiplier("drag_multiplier");
        micro = Sectors(At(track, "micro_sectors"), true);
        for (int i = 0; i < micro.Length; i++) if (micro[i].Type is SectorType.Low or SectorType.Med or SectorType.High) micro[i] = micro[i] with { Target = micro[i].Target * corner };
        transitions = Transitions(micro);
        if (projectedWind is { Sectors.Length: > 0 })
        {
            var sectors = projectedWind.Sectors;
            int count = sectors.Length;
            if (count > 2048) throw new ArgumentException("Wind geometry exceeds 2,048 sectors.");
            sources = sectors.Select(sector => sector.Source).ToArray();
            distances = sectors.Select(sector => length * sector.LengthPercent / 100).ToArray();
            losses = sectors.Select(sector => sector.CornerLoss).ToArray();
            tails = sectors.Select(sector => sector.Tailwind).ToArray();
            brakeCap = projectedWind.BrakeCap;
        }
        else if (wind.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
        {
            var sectors = Sectors(At(wind, "sectors"), false); int count = sectors.Length;
            double[] Values(string key)
            {
                var value = At(wind, key);
                if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != count) throw new ArgumentException($"Wind {key} must match its sector count.");
                return value.EnumerateArray().Select(item => LapInput.Need(item, $"wind {key}")).ToArray();
            }
            var indices = Values("sources");
            if (indices.Any(index => index != Math.Truncate(index) || index < 0 || index >= micro.Length)) throw new ArgumentException("Invalid wind source-sector index.");
            sources = indices.Select(index => (int)index).ToArray(); distances = sectors.Select(sector => length * sector.Percent / 100).ToArray(); losses = Values("losses"); tails = Values("tails");
            brakeCap = LapInput.Need(At(wind, "brake_cap"), "wind brake cap");
            if (brakeCap < 0 || brakeCap > 1 || losses.Any(loss => loss < 0 || loss >= 1) || tails.Any(tail => Math.Abs(tail) > 100)) throw new ArgumentException("Invalid wind field values.");
        }
        else
        {
            distances = micro.Select(sector => length * (sector.Percent / 100)).ToArray();
            losses = []; tails = new double[distances.Length];
        }
        targets = new double[micro.Length]; caps = new double[distances.Length]; brakes = new double[distances.Length];
        integrator = new(distances.Length);
    }

    static Transition[] Transitions(Sector[] sectors)
    {
        var result = new List<Transition>();
        // Lookup does not wrap; only the integrator closes the flying lap.
        for (int i = 0; i < sectors.Length; i++) if (sectors[i].High == 0)
        {
            int before = i - 1, after = i + 1;
            while (before >= 0 && sectors[before].High == 0) before--;
            while (after < sectors.Length && sectors[after].High == 0) after++;
            result.Add(new(i, before, after == sectors.Length ? -1 : after));
        }
        return result.ToArray();
    }

    public double Evaluate(LapInput input)
    {
        double referenceMass = Math.Max(300, input.ReferenceMass), mass = Math.Max(300, input.CarMass + input.EngineMass + Math.Max(0, input.FuelMass));
        double cornerMass = Clamp(1 + (Math.Sqrt(referenceMass / mass) - 1) * .5, .84, 1.08);
        for (int i = 0; i < micro.Length; i++)
        {
            var sector = micro[i];
            if (sector.High == 0) continue;
            double points = sector.Type switch { SectorType.Low => input.Slow, SectorType.Med => input.Med, SectorType.High => input.High, SectorType.Corner => input.Corner, _ => 0 };
            double speed = sector.Target + sector.RatingFactor * points;
            if (sector.Type != SectorType.Straight)
            {
                speed += sector.PaceFactor * input.TeamPace;
                speed += input.DriverCorner; speed *= cornerMass; speed *= Clamp(input.Lateral, .3, 1.4);
            }
            targets[i] = Clamp(speed, sector.Low, sector.High);
        }
        foreach (var transition in transitions)
            targets[transition.Index] = transition.Before < 0 && transition.After < 0 ? 200
                : Math.Max(5, Math.Max(transition.Before < 0 ? 0 : targets[transition.Before], transition.After < 0 ? 0 : targets[transition.After]));
        double accel = Clamp((7 * acceleration + input.Acceleration * .015) * Clamp(input.Longitudinal, .25, 1.5), 1, 10);
        double brake = Clamp((12 * braking + input.Braking * .06 + input.DriverBraking) * Clamp(input.Longitudinal, .25, 1.5), 3, 16);
        double power = Clamp(1 + .75 * (((750 + (Clamp(input.EnginePower, 0, 100) - 50) * 4) / 750) - 1), .55, 1.45);
        double propulsion = accel * power * Clamp(1 + (referenceMass / mass - 1) * .5, .7, 1.25), drag = .00018 * dragMultiplier * Clamp(1 - input.Straight * .01, .55, 1.6);
        double sensitivity = Math.Pow(2, (50 - Clamp(input.Aero, 0, 100)) / 50);
        for (int i = 0; i < caps.Length; i++)
        {
            double speed = sources == null ? targets[i] / 3.6 : targets[sources[i]] * (1 - losses[i] * sensitivity) / 3.6;
            caps[i] = Math.Max(.5, speed); brakes[i] = brake;
            if (sources != null)
            {
                double air = Math.Max(0, speed - tails[i] * Clamp((speed - 5) / 15, 0, 1));
                double delta = drag * (air * air - speed * speed), limit = brake * brakeCap;
                brakes[i] = Math.Max(.05, brake + Clamp(delta, -limit, limit));
            }
        }
        return integrator.Integrate(distances, caps, brakes, tails, propulsion, drag, sources != null);
    }

    public static double[] Prepared(string json)
    {
        using var document = JsonDocument.Parse(json); var root = document.RootElement;
        if (Number(At(root, "version")) != 1) throw new ArgumentException("Unsupported lap-engine contract version.");
        var inputs = At(root, "inputs");
        if (inputs.ValueKind != JsonValueKind.Array || inputs.GetArrayLength() > 64) throw new ArgumentException("A lap batch supports at most 64 prepared inputs.");
        var model = new MotionModel(At(root, "track"), At(root, "car_profile"), wind: At(root, "wind"));
        return inputs.EnumerateArray().Select(input => model.Evaluate(LapInput.Read(input))).ToArray();
    }
}
