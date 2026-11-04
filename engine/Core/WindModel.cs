using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>One projected sector: source index, percentage length, corner loss and tailwind in m/s.</summary>
public readonly record struct WindSector(int Source, double LengthPercent, double CornerLoss, double Tailwind);

/// <summary>Initial practice wind and its projection onto the selected circuit outline.</summary>
public sealed record WindModel(double Speed, double Direction, double BrakeCap, WindSector[] Sectors)
{
    readonly record struct Edge(double End, double X, double Y);

    public static WindModel Build(JsonElement source, int seed, string? trackId = null, bool? testing = null)
    {
        var config = At(At(At(source, "definitions"), "config"), "wind");
        if (!Enabled(source, config)) return new(0, 0, 0, []);

        var (low, high) = StartingSpeeds(config);
        string id = trackId ?? Text(At(source, "trackId"));
        bool isTesting = testing ?? Flag(At(source, "testing"));
        var (speed, direction) = StartingWind(seed, id, isTesting, low, high);
        var track = At(source, "track");
        var outline = Outline(At(track, "points"));
        // A degenerate outline still has a forecast, but contributes no lap effects.
        if (outline.Length < 2) return new(speed, direction, 0, []);

        double brakeCap = Clamp(Number(At(config, "braking_change_cap"), .02), 0, .05);
        var sectors = Project(track, config, outline, speed, direction);
        return new(speed, direction, brakeCap, sectors);
    }

    static bool Enabled(JsonElement source, JsonElement config)
    {
        var enabled = At(At(source, "sessionOptions"), "wind_enabled");
        return enabled.ValueKind != JsonValueKind.False
            && (enabled.ValueKind == JsonValueKind.True || At(config, "enabled").ValueKind != JsonValueKind.False);
    }

    static (double Low, double High) StartingSpeeds(JsonElement config)
    {
        double maximum = Clamp(Number(At(config, "maximum_speed_kmh"), 50), 0, 80);
        var range = At(config, "starting_speed_kmh");
        double[] bounds = range.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
            ? [5, 20] : Items(range).Select(value => Number(value)).ToArray();
        if (bounds.Length != 2) throw new ArgumentException("Wind starting speed needs two values.");
        double first = Clamp(bounds[0], 0, maximum), second = Clamp(bounds[1], 0, maximum);
        return (Math.Min(first, second), Math.Max(first, second));
    }

    static (double Speed, double Direction) StartingWind(int seed, string id, bool testing, double low, double high)
    {
        if (id.Length == 0) throw new ArgumentException("A circuit identifier is required for the session seed.");
        string phase = testing ? "preseason_testing" : "practice";
        // Match the game's per-circuit seed and draw speed before direction.
        byte[] digest = SHA256.HashData(Encoding.UTF8.GetBytes($"wind-v1:{seed}:{id}:{phase}:0"));
        var random = new GameRandom(BinaryPrimitives.ReadUInt64BigEndian(digest));
        return (random.Uniform(low, high), random.Uniform(0, 360));
    }

    static Edge[] Outline(JsonElement rawPoints)
    {
        if (rawPoints.ValueKind != JsonValueKind.Array || rawPoints.GetArrayLength() > 100000)
            throw new ArgumentException("Track outline is missing or too large for wind calculation.");
        var points = new List<(double X, double Y)>();
        foreach (var point in rawPoints.EnumerateArray())
        {
            if (point.ValueKind != JsonValueKind.Array || point.GetArrayLength() < 2)
                throw new ArgumentException("Invalid track outline point.");
            var pair = (Number(point[0]), Number(point[1]));
            if (points.Count == 0 || pair != points[^1]) points.Add(pair);
        }
        if (points.Count > 0 && points[0] != points[^1]) points.Add(points[0]);

        var edges = new List<Edge>();
        double distance = 0;
        for (int i = 1; i < points.Count; i++)
        {
            double dx = points[i].X - points[i - 1].X, dy = points[i].Y - points[i - 1].Y;
            double length = double.Hypot(dx, dy);
            if (length == 0) continue;
            distance += length;
            edges.Add(new(distance, dx / length, dy / length));
        }
        for (int i = 0; i < edges.Count; i++) edges[i] = edges[i] with { End = edges[i].End / distance };
        return edges.ToArray();
    }

    static Edge Tangent(Edge[] outline, double progress)
    {
        double position = ((progress % 1) + 1) % 1;
        int low = 0, high = outline.Length;
        while (low < high)
        {
            int mid = (low + high) >> 1;
            // An exact boundary belongs to the following edge.
            if (outline[mid].End <= position) low = mid + 1;
            else high = mid;
        }
        return outline[Math.Min(low, outline.Length - 1)];
    }

    static bool Bends(Edge[] outline, double start, double length)
    {
        var previous = Tangent(outline, start + length * .125);
        for (int i = 1; i < 4; i++)
        {
            var next = Tangent(outline, start + length * ((i + .5) / 4));
            if (next.X * previous.X + next.Y * previous.Y < .5) return true;
            previous = next;
        }
        return false;
    }

    static WindSector[] Project(JsonElement track, JsonElement config, Edge[] outline, double speed, double direction)
    {
        double wx = speed / 3.6 * Math.Sin(direction * Math.PI / 180);
        double wy = -speed / 3.6 * Math.Cos(direction * Math.PI / 180);
        double reference = Clamp(Number(At(config, "crosswind_reference_kmh"), 30), 1, 100);
        double lossCap = Clamp(Number(At(config, "crosswind_corner_loss"), .02), 0, .05);
        var micro = Items(At(track, "micro_sectors")).ToArray();
        double total = micro.Sum(sector => Number(At(sector, "length_pct")));
        if (!double.IsFinite(total) || total <= 0) throw new ArgumentException("Wind sectors need positive total length.");

        var result = new List<WindSector>();
        double cursor = 0;
        for (int index = 0; index < micro.Length; index++)
        {
            var sector = micro[index];
            double percent = Number(At(sector, "length_pct")), length = percent / total;
            // Split a bent sector so opposing winds do not collapse into one midpoint sample.
            int count = Bends(outline, cursor, length) ? 4 : 1;
            double weight = Text(At(sector, "type")) switch { "low" => .25, "med" or "corner" => .6, "high" => 1, _ => 0 };
            for (int i = 0; i < count; i++)
            {
                var tangent = Tangent(outline, cursor + length * (i + .5) / count);
                double cross = -wx * tangent.Y + wy * tangent.X;
                double loss = Math.Min(lossCap, lossCap * Math.Pow(cross * 3.6 / reference, 2)) * weight;
                double tailwind = wx * tangent.X + wy * tangent.Y;
                result.Add(new(index, percent * (100 / total) / count, loss, tailwind));
            }
            cursor += length;
        }
        return result.ToArray();
    }
}
