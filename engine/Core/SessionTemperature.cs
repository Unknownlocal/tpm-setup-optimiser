using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Fresh practice/testing temperature, with the game's shared forecast draw order.</summary>
public static class SessionTemperature
{
    static readonly double[][] Ranges = [[10,18,12,22], [18,24,18,28], [24,32,28,36], [30,36,18,24], [15,22,30,38], [30,38,32,40]];

    public static int Seed(double value)
    {
        if (!double.IsFinite(value) || value < 0 || value > 999999 || value != Math.Truncate(value))
            throw new ArgumentException("The session seed must be a whole number between 0 and 999999.");
        return (int)value;
    }

    static double[] Curve(int laps, GameRandom random)
    {
        var range = Ranges[random.Integer(0, Ranges.Length - 1)];
        double start = random.Uniform(range[0], range[1]), end = random.Uniform(range[2], range[3]);
        var points = new List<(int Lap, double Value)> { (0, start) };
        if (laps > 1)
        {
            int mids = laps > 6 ? random.Integer(0, 3) : 0;
            var picks = random.SampleIndices(laps - 2, mids); Array.Sort(picks);
            for (int i = 0; i < picks.Length; i++) points.Add((picks[i] + 1, Clamp(start + (end - start) * ((i + 1.0) / (mids + 1)) + random.Uniform(-5, 5), 10, 40)));
            points.Add((laps - 1, end));
        }
        var result = new double[laps];
        for (int lap = 0; lap < laps; lap++)
        {
            double value = points[^1].Value;
            for (int i = 1; i < points.Count; i++) if (lap <= points[i].Lap)
            {
                var (left, low) = points[i - 1]; var (right, high) = points[i];
                value = low + (high - low) * ((lap - left) / (double)(right - left)); break;
            }
            result[lap] = Clamp(value + random.Uniform(-.8, .8), 10, 40);
        }
        return result;
    }

    static void AdvanceWetForecast(GameRandom random, int laps, JsonElement source)
    {
        var constants = At(At(source, "definitions"), "constants");
        double dry = Probability(Number(At(constants, "RACE_WEATHER_DRY_PROB"), .95));
        double[] wet = [Probability(Number(At(constants, "RACE_WEATHER_PASSING_SHOWERS_PROB"), .02)), Probability(Number(At(constants, "RACE_WEATHER_DRY_TO_WET_PROB"), .015)), Probability(Number(At(constants, "RACE_WEATHER_WET_TO_DRY_PROB"), .015))];
        var raw = At(At(source, "track"), "wet_weather_probability_multiplier");
        double multiplier = 1;
        if (raw.ValueKind == JsonValueKind.Number) multiplier = Number(raw);
        else if (raw.ValueKind == JsonValueKind.String && double.TryParse(Text(raw), NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed)) multiplier = parsed;
        if (!double.IsFinite(multiplier) || multiplier < 0) multiplier = 1;
        if (multiplier != 1)
        {
            double sum = wet.Sum(), total = sum + Math.Max(0, 1 - (dry + sum));
            double chance = total <= 0 ? 0 : Math.Min(1, total * multiplier);
            for (int i = 0; i < wet.Length; i++) wet[i] = total <= 0 ? 0 : wet[i] * (chance / total);
            dry = 1 - chance;
        }
        double roll = random.Random(); if (roll < dry) return;
        int draws = roll < dry + wet[0] ? 7 : roll < dry + wet[0] + wet[1] ? 5 : roll < dry + wet[0] + wet[1] + wet[2] ? 6
            : random.Random() < .5 ? 7 * random.Integer(2, 3) : 6;
        // Water stays user supplied; replay only the draws preceding temperature blending.
        for (int i = 0; i < draws + laps; i++) random.Random();
    }

    static double Probability(double value) => value >= 0 && value <= 1 ? value : throw new ArgumentException("Invalid wet forecast probability.");

    public static double[] Profile(JsonElement source, int seed)
    {
        Seed(seed);
        double basis = Math.Truncate(Number(At(At(source, "sessionOptions"), "laps"), 12));
        double modifier = Flag(At(source, "trackLapModifiersEnabled")) ? Number(At(At(source, "track"), "lap_modifier"), 1) : 1;
        double count = Math.Max(1, Math.Round(basis * modifier, MidpointRounding.ToEven));
        if (!double.IsFinite(count) || count > 10000) throw new ArgumentException("Session temperature profile exceeds 10,000 laps.");
        int laps = (int)count;
        var earlier = Curve(laps, new GameRandom((ulong)(seed + 137)));
        var random = new GameRandom((ulong)(seed + 73)); var practice = Curve(laps, random);
        if (Number(At(At(source, "weather"), "wetness_mm")) > 0) AdvanceWetForecast(random, laps, source);
        for (int i = 0; i < laps; i++) practice[i] = Clamp(.72 * practice[i] + .28 * earlier[i] + random.Uniform(-1.5, 1.5), 10, 40);
        return practice;
    }

    /// <summary>Return ambient temperature and generated sample count; zero count marks a manual value.</summary>
    public static double[] Resolve(string json, double seed)
    {
        int checkedSeed = Seed(seed); using var document = JsonDocument.Parse(json);
        var source = document.RootElement; var manual = At(At(source, "weather"), "temperature_c");
        if (manual.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)) return [Number(manual), 0];
        var profile = Profile(source, checkedSeed);
        double sum = 0; foreach (double value in profile) sum += value;
        return [sum / profile.Length, profile.Length];
    }
}
