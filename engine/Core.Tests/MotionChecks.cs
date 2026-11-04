#nullable enable
using System;
using System.Linq;
using System.Text.Json;
using Tpm.Setup.Core;

/// <summary>Adjacent transitions and changing car inputs on the same reusable motion workspace.</summary>
static class MotionChecks
{
    public static void Run()
    {
        using var track = JsonDocument.Parse("""
        {"length_km":0.45,"micro_sectors":[
          {"type":"braking","length_pct":10},{"type":"acceleration","length_pct":10},
          {"type":"low","length_pct":20,"target_speed_kmh":80},
          {"type":"braking","length_pct":10},{"type":"acceleration","length_pct":10},
          {"type":"straight","length_pct":20,"target_speed_kmh":150},
          {"type":"braking","length_pct":10},{"type":"acceleration","length_pct":10}]}
        """);
        var initial = new LapInput(0, 0, 0, 0, 0, 0, 0, 0, 50, 660, 120, 15, 800, 0, 0, 1, 1, 50);
        var changed = initial with { Slow = 30, DriverCorner = 2, CarMass = 900, Lateral = .75, Longitudinal = .8, Straight = 10, Aero = 20 };
        void Check(WindModel? wind, double expected, double changedExpected)
        {
            var model = new MotionModel(track.RootElement, default, wind);
            void Near(LapInput input, double time)
            {
                double actual = model.Evaluate(input);
                if (!double.IsFinite(actual) || Math.Abs(actual - time) > 1e-9) throw new Exception("Transition lookup or motion workspace reuse changed the lap.");
            }
            Near(initial, expected); Near(changed, changedExpected);
            Near(initial, expected); // Return to the first car after all scratch values changed.
        }
        Check(null, 15.40147718016962, 19.197080701310195);
        int[] lengths = [10, 10, 20, 10, 10, 20, 10, 10];
        var wind = new WindModel(36, 90, .02, lengths.Select((length, i) => new WindSector(i, length, .01, i % 2 == 0 ? 3 : -2)).ToArray());
        Check(wind, 15.538853263181826, 19.43307882442059);
        Console.WriteLine("Compiled motion and workspace reuse checks passed.");
    }
}
