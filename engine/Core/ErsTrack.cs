using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>The game's deployment-window coverage, compiled once for a circuit.</summary>
internal static class ErsTrack
{
    public static double MaximumCoverage(JsonElement track)
    {
        var sectors = Items(At(track, "micro_sectors")).ToArray();
        double total = sectors.Sum(sector => Number(At(sector, "length_pct")));
        if (total <= 0) throw new ArgumentException("ERS needs a circuit with positive sector lengths.");
        var basic = new List<(double Start, double End)>();
        var extended = new List<(double Start, double End)>();
        double progress = 0, scale = 100 / total;
        static int Rank(JsonElement sector) => Text(At(sector, "type")) switch
        { "low" => 0, "med" => 1, "high" or "corner" => 2, "straight" => 3, _ => -1 };
        for (int i = 0; i < sectors.Length; i++)
        {
            string type = Text(At(sectors[i], "type"));
            double start = Clamp(progress / 100, 0, 1);
            progress += Number(At(sectors[i], "length_pct")) * scale;
            double end = Clamp(progress / 100, 0, 1), width = end - start;
            if (width <= 1e-6) continue;
            if (type is "acceleration" or "straight") extended.Add((start, end));
            if (type == "acceleration") { basic.Add((start, end)); continue; }
            int current = Rank(sectors[i]);
            if (current < 0) continue;
            for (int step = 1; step <= sectors.Length; step++)
            {
                int previous = Rank(sectors[(i - step + sectors.Length) % sectors.Length]);
                if (previous < 0) continue;
                if (current > previous) basic.Add((start, Math.Min(end, start + Math.Min(width * .4, .08))));
                break;
            }
        }
        if (basic.Count == 0) basic.AddRange([(.12, .2), (.44, .52), (.76, .84)]);
        // For a hotlap only the covered length matters. The game caps expanded
        // windows at their union with full acceleration/straight sectors.
        double baseline = Length(basic);
        extended.AddRange(basic);
        return Length(extended) / baseline;
    }

    static double Length(List<(double Start, double End)> windows)
    {
        double length = 0, end = 0;
        foreach (var window in windows.OrderBy(window => window.Start))
        {
            length += Math.Max(0, window.End - Math.Max(end, window.Start));
            end = Math.Max(end, window.End);
        }
        return length;
    }
}
