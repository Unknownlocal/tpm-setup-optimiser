using System;
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
    readonly double[] car, setup;
    readonly double[][] tyres;
    readonly double cornerBonus, brakingBonus, water;
    readonly MotionModel motion;
    readonly SettingSpace? space;

    public DriverScenario(JsonElement source, JsonElement driver, int index, double[] cars, double[] conditions, MotionModel motion, bool search = true)
    {
        Name = Text(At(driver, "name")); Entry = (int)Number(At(driver, "entry"));
        car = cars.AsSpan(1 + index * SavedCar.RecordLength, SavedCar.ValueLength).ToArray();
        setup = cars.AsSpan(1 + index * SavedCar.RecordLength + SavedCar.ValueLength, FormulaSetup.ModelLength).ToArray();
        Compounds = Items(At(source, "tyres")).Select(tyre => Text(At(tyre, "name"))).ToArray();
        tyres = new double[Compounds.Length][];
        int offset = 8 + (int)conditions[6];
        for (int i = 0; i < tyres.Length; i++) tyres[i] = conditions.AsSpan(offset + i * TyreGrip.ModelLength, TyreGrip.ModelLength).ToArray();
        var preferences = At(driver, "preferences"); BalancePreference = Number(At(preferences, "balance_preference")); TractionPreference = Number(At(preferences, "traction_preference"));
        var skills = At(driver, "skills"); cornerBonus = Math.Max(0, Number(At(skills, "cornering"))) * .1 + conditions[8 + index] + .4; brakingBonus = Math.Max(0, Number(At(skills, "braking"))) * .03;
        water = Number(At(At(source, "weather"), "wetness_mm")); WindSpeed = conditions[1]; WindDirection = conditions[2];
        Initial = SettingSpace.ReadSettings(At(source, "settings")); ReferenceBounds = ReferenceGuidance.Bounds(At(source, "setupDefinitions")); space = search ? new(At(source, "setupAxes")) : null; this.motion = motion;
    }

    public double Ceiling(SetupPoint point)
    {
        var row = FormulaSetup.Evaluate(setup, Space.Settings(point));
        return 85 + .15 * SetupGrading.Preference(row[6], row[7], BalancePreference, TractionPreference);
    }

    public LapResult Evaluate(int compound, double[] settings, bool includeInputs = false)
    {
        var row = TyreGrip.Setups(setup, tyres[compound], settings, car[12] == 1);
        var input = new LapInput(car[0] + row[0] / .084375, car[1] + row[1] / .09375, car[2] + row[2] / .15, 0, car[3] + row[3] / .18,
            car[4] + (water > 1 ? car[11] : 0), car[6], car[5] + row[4] / .015 + 40, car[9], Math.Max(300, car[7]), car[10], 15, 800,
            cornerBonus, brakingBonus, row[9], row[10], car[8]);
        return new() { Compound = Compounds[compound], Settings = settings, Balance = row[6], Traction = row[7], Temperature = row[8], Lateral = row[9], Longitudinal = row[10], Lap = motion.Evaluate(input), Inputs = includeInputs ? input : null };
    }
}
