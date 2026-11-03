using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Initial practice wind and its projection onto the selected circuit outline.</summary>
public sealed class WindModel
{
    public double Speed { get; private set; }
    public double Direction { get; private set; }
    public double BrakeCap { get; private set; }
    // Each numerical row is source-sector index, relative length, corner loss, tailwind.
    public List<double> Sectors { get; } = [];
    readonly record struct Edge(double End, double X, double Y);

    public static WindModel Build(JsonElement source, int seed)
    {
        var result = new WindModel();
        var cfg = At(At(At(source, "definitions"), "config"), "wind");
        var enabled = At(At(source, "sessionOptions"), "wind_enabled");
        if (enabled.ValueKind == JsonValueKind.False || (enabled.ValueKind != JsonValueKind.True && At(cfg, "enabled").ValueKind == JsonValueKind.False)) return result;
        double max = Clamp(Number(At(cfg, "maximum_speed_kmh"), 50), 0, 80);
        var range = At(cfg, "starting_speed_kmh");
        double[] bounds = range.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? [5, 20] : Items(range).Select(value => Number(value)).ToArray();
        if (bounds.Length != 2) throw new ArgumentException("Wind starting speed needs two values.");
        bounds = bounds.Select(value => Clamp(value, 0, max)).Order().ToArray();
        string id = Text(At(source, "trackId"));
        if (id.Length == 0) throw new ArgumentException("A circuit identifier is required for the session seed.");
        string phase = Flag(At(source, "testing")) ? "preseason_testing" : "practice";
        byte[] digest = SHA256.HashData(Encoding.UTF8.GetBytes($"wind-v1:{seed}:{id}:{phase}:0"));
        var random = new GameRandom(BinaryPrimitives.ReadUInt64BigEndian(digest));
        result.Speed = random.Uniform(bounds[0], bounds[1]); result.Direction = random.Uniform(0, 360);
        double wx = result.Speed / 3.6 * Math.Sin(result.Direction * Math.PI / 180), wy = -result.Speed / 3.6 * Math.Cos(result.Direction * Math.PI / 180);
        var track = At(source, "track"); var rawPoints = At(track, "points");
        if (rawPoints.ValueKind != JsonValueKind.Array || rawPoints.GetArrayLength() > 100000) throw new ArgumentException("Track outline is missing or too large for wind calculation.");
        var points = new List<(double X, double Y)>();
        foreach (var point in rawPoints.EnumerateArray())
        {
            if (point.ValueKind != JsonValueKind.Array || point.GetArrayLength() < 2) throw new ArgumentException("Invalid track outline point.");
            var pair = (Number(point[0]), Number(point[1]));
            if (points.Count == 0 || pair != points[^1]) points.Add(pair);
        }
        if (points.Count > 0 && points[0] != points[^1]) points.Add(points[0]);
        var edges = new List<Edge>(); double distance = 0;
        for (int i = 1; i < points.Count; i++)
        {
            double dx = points[i].X - points[i - 1].X, dy = points[i].Y - points[i - 1].Y, length = double.Hypot(dx, dy);
            if (length > 0) { distance += length; edges.Add(new(distance, dx / length, dy / length)); }
        }
        if (edges.Count < 2) return result;
        for (int i = 0; i < edges.Count; i++) edges[i] = edges[i] with { End = edges[i].End / distance };
        Edge Tangent(double progress)
        {
            double p = ((progress % 1) + 1) % 1; int low = 0, high = edges.Count;
            while (low < high) { int mid = (low + high) >> 1; if (edges[mid].End <= p) low = mid + 1; else high = mid; }
            return edges[Math.Min(low, edges.Count - 1)];
        }
        result.BrakeCap = Clamp(Number(At(cfg, "braking_change_cap"), .02), 0, .05);
        var micro = Items(At(track, "micro_sectors")).ToArray();
        double total = micro.Sum(sector => Number(At(sector, "length_pct")));
        if (!double.IsFinite(total) || total <= 0) throw new ArgumentException("Wind sectors need positive total length.");
        double reference = Clamp(Number(At(cfg, "crosswind_reference_kmh"), 30), 1, 100), lossCap = Clamp(Number(At(cfg, "crosswind_corner_loss"), .02), 0, .05);
        double cursor = 0;
        for (int index = 0; index < micro.Length; index++)
        {
            var sector = micro[index]; double percent = Number(At(sector, "length_pct")), length = percent / total;
            var samples = new[] { .125, .375, .625, .875 }.Select(p => Tangent(cursor + length * p)).ToArray();
            bool bent = false; for (int i = 1; i < samples.Length; i++) bent |= samples[i].X * samples[i - 1].X + samples[i].Y * samples[i - 1].Y < .5;
            int count = bent ? 4 : 1;
            for (int i = 0; i < count; i++)
            {
                var tangent = Tangent(cursor + length * (i + .5) / count);
                double cross = -wx * tangent.Y + wy * tangent.X;
                double weight = Text(At(sector, "type")) switch { "low" => .25, "med" or "corner" => .6, "high" => 1, _ => 0 };
                result.Sectors.AddRange([index, percent * (100 / total) / count, Math.Min(lossCap, lossCap * Math.Pow(cross * 3.6 / reference, 2)) * weight, wx * tangent.X + wy * tangent.Y]);
            }
            cursor += length;
        }
        return result;
    }
}
