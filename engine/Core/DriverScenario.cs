using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Fixed equipment and conditions for one entry; all candidate and reference laps share it.</summary>
public sealed class DriverScenario
{
    public string Name { get; }
    public int Entry { get; }
    public string[] Compounds { get; }
    public double[] Initial { get; }
    public double[] ReferenceBounds { get; }
    public SettingSpace Space => space ?? throw new InvalidOperationException("This scenario was prepared for grading only.");
    public double BalancePreference { get; }
    public double TractionPreference { get; }
    public double WindSpeed { get; }
    public double WindDirection { get; }
    public int SetupCacheEntries => effects?.Count ?? 0;
    const int SetupCacheLimit = 2048;
    Dictionary<SetupPoint, SetupEffects>? effects;
    readonly double[] car;
    readonly FormulaSetup setup;
    readonly TyreGrip[] tyres;
    readonly double cornerBonus, brakingBonus, water, ersBonus, fuelKg, enginePower;
    readonly MotionModel motion;
    readonly SettingSpace? space;

    public DriverScenario(JsonElement source, JsonElement driver, int index, double[] cars, SessionConditions conditions, MotionModel motion, bool search = true)
    {
        Name = Text(At(driver, "name")); Entry = (int)Number(At(driver, "entry"));
        car = cars.AsSpan(1 + index * SavedCar.RecordLength, SavedCar.ValueLength).ToArray();
        setup = new(cars.AsSpan(1 + index * SavedCar.RecordLength + SavedCar.ValueLength, FormulaSetup.ModelLength));
        Compounds = Items(At(source, "tyres")).Select(tyre => Text(At(tyre, "name"))).ToArray();
        tyres = conditions.Tyres;
        ersBonus = conditions.ErsBonuses[index];
        var preferences = At(driver, "preferences"); BalancePreference = Number(At(preferences, "balance_preference")); TractionPreference = Number(At(preferences, "traction_preference"));
        var driving = DrivingSettings.Read(source); fuelKg = driving.FuelKg;
        // Mode adjusts the worn fitted engine; clamp once for all reference and candidate laps.
        enginePower = Clamp(car[9] + driving.EnginePowerDelta, 0, 100);
        var skills = At(driver, "skills"); cornerBonus = Math.Max(0, Number(At(skills, "cornering"))) * .1 + conditions.CornerVariations[index] + driving.CorneringBonus; brakingBonus = Math.Max(0, Number(At(skills, "braking"))) * .03;
        water = Number(At(At(source, "weather"), "wetness_mm")); WindSpeed = conditions.Wind.Speed; WindDirection = conditions.Wind.Direction;
        Initial = SettingSpace.ReadSettings(At(source, "settings")); ReferenceBounds = ReferenceGuidance.Bounds(At(source, "setupDefinitions")); space = search ? new(At(source, "setupAxes")) : null; this.motion = motion;
    }

    public double Ceiling(SetupPoint point)
    {
        var result = Effects(point);
        return 85 + .15 * SetupGrading.Preference(result.Balance, result.Traction, BalancePreference, TractionPreference);
    }

    SetupEffects Effects(SetupPoint point)
    {
        // Only compound-independent effects are shared. Grip, laps and grades stay per compound.
        effects ??= new(SetupCacheLimit);
        if (!effects.TryGetValue(point, out var result))
        {
            // Most random proposals are pruned. Evict derived effects without losing scored laps or RNG state.
            if (effects.Count == SetupCacheLimit) effects.Clear();
            effects[point] = result = setup.Evaluate(Space.Settings(point));
        }
        return result;
    }

    public LapResult Evaluate(int compound, SetupPoint point) => Evaluate(compound, Space.Settings(point), Effects(point), false);

    // Guidance keeps its original floating-point settings rather than snapping to search ticks.
    public LapResult Evaluate(int compound, double[] settings, bool includeInputs = false) => Evaluate(compound, settings, setup.Evaluate(settings), includeInputs);

    LapResult Evaluate(int compound, double[] settings, SetupEffects effects, bool includeInputs)
    {
        var grip = tyres[compound].Evaluate(effects.TemperatureDelta, car[12] == 1);
        var input = new LapInput(car[0] + effects.Slow / .084375, car[1] + effects.Med / .09375, car[2] + effects.High / .15, 0, car[3] + effects.Straight / .18,
            car[4] + (water > 1 ? car[11] : 0), car[6], car[5] + effects.Acceleration / .015 + ersBonus, enginePower, Math.Max(300, car[7]), car[10], fuelKg, 800,
            cornerBonus, brakingBonus, grip.Lateral, grip.Longitudinal, car[8]);
        return new() { Compound = Compounds[compound], Settings = settings, Balance = effects.Balance, Traction = effects.Traction, Temperature = grip.Temperature, Lateral = grip.Lateral, Longitudinal = grip.Longitudinal, Lap = motion.Evaluate(input), Inputs = includeInputs ? input : null };
    }

    public void ClearCache() => effects = null;
}
