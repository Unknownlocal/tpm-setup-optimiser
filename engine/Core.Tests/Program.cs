using System;
using Tpm.Setup.Core;

static void Near(double actual, double expected)
{
    if (!double.IsFinite(actual) || Math.Abs(actual - expected) > 1e-9)
        throw new Exception($"Expected {expected}, received {actual}.");
}

// A constant-speed flying lap has a direct distance/speed solution.
Near(LapIntegrator.Integrate([400], [20], [10], [0], 7, .00018, false), 20);
// Authored three-zone laps exercise acceleration, braking closure and wind.
Near(LapIntegrator.Integrate([200, 100, 150], [35, 15, 30], [10, 9, 11], [0, 0, 0], 7, .00018, false), 18.340876470509045);
Near(LapIntegrator.Integrate([200, 100, 150], [35, 15, 30], [10, 9, 11], [3, -2, 1], 7, .00018, true), 18.3405338872926);

try
{
    LapIntegrator.Integrate([double.NaN], [20], [10], [0], 7, .00018, false);
    throw new Exception("Invalid geometry was accepted.");
}
catch (ArgumentException) { }
Console.WriteLine("Core lap checks passed.");
