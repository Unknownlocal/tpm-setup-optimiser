using System;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using Tpm.Setup.Core;

/// <summary>Accept local simulation projections and numerical batches without retaining browser state.</summary>
[SupportedOSPlatform("browser")]
public static partial class EngineExports
{
    public static void Main() { }

    [JSExport]
    public static int ContractVersion() => 1;

    [JSExport]
    public static int CarContractVersion() => 1;

    [JSExport]
    public static double[] BuildCars(string json) => SavedCar.Build(json);

    [JSExport]
    public static double[] EvaluateSetups(double[] model, double[] settings) => FormulaSetup.Evaluate(model, settings);

    [JSExport]
    public static int ConditionsContractVersion() => 1;

    [JSExport]
    public static double[] ResolveTemperature(string json, double seed) => SessionTemperature.Resolve(json, seed);

    [JSExport]
    public static double[] BuildConditions(string json, double seed) => SessionConditions.Build(json, seed);

    [JSExport]
    public static double[] EvaluateSetupTyres(double[] model, double[] tyres, double[] settings, bool protectedTemperature) => TyreGrip.Setups(model, tyres, settings, protectedTemperature);

    [JSExport]
    public static double[] RandomWords(string seed, double[] state) => GameRandom.Words(seed, state);

    [JSExport]
    public static double[] Evaluate(double[] packet)
    {
        if (packet.Length < 2 || packet[0] != ContractVersion()) throw new ArgumentException("Unsupported lap packet version.");
        int count = Whole(packet[1], 0, 64), offset = 2;
        var times = new double[count];
        for (int i = 0; i < count; i++)
        {
            if (packet.Length - offset < 4) throw new ArgumentException("Truncated lap packet.");
            int n = Whole(packet[offset], 1, 2048);
            if (packet.Length - offset < 4 + 4 * n) throw new ArgumentException("Truncated lap sectors.");
            double propulsion = packet[offset + 1], drag = packet[offset + 2], windy = packet[offset + 3];
            if (windy != 0 && windy != 1) throw new ArgumentException("Invalid wind flag.");
            var distances = packet.AsSpan(offset + 4, n); var caps = packet.AsSpan(offset + 4 + n, n);
            var brakes = packet.AsSpan(offset + 4 + 2 * n, n); var tails = packet.AsSpan(offset + 4 + 3 * n, n);
            times[i] = LapIntegrator.Integrate(distances, caps, brakes, tails, propulsion, drag, windy == 1);
            offset += 4 + 4 * n;
        }
        if (offset != packet.Length) throw new ArgumentException("Unexpected trailing lap data.");
        return times;
    }

    static int Whole(double value, int min, int max)
    {
        if (!double.IsFinite(value) || value < min || value > max || value != Math.Truncate(value))
            throw new ArgumentException("Invalid lap packet count.");
        return (int)value;
    }
}
