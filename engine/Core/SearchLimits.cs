using System;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Only newly simulated component laps count towards post-S+ refinement limits.</summary>
public sealed record SearchLimits(double Seconds = 15, int RefineLaps = 500, int StallLaps = 100, int IdleBatches = 64, int CacheEntries = SearchLimits.DefaultCacheEntries)
{
    public const int DefaultCacheEntries = 4096;
    public static SearchLimits Read(JsonElement raw)
    {
        double seconds = Number(At(raw, "seconds"), 15);
        int Whole(string key, int fallback, int minimum = 1)
        {
            double value = Number(At(raw, key), fallback);
            if (value < minimum || value > 100000 || value != Math.Truncate(value)) throw new ArgumentException($"{key} must be a whole number between {minimum} and 100000.");
            return (int)value;
        }
        if (seconds < .1 || seconds > 300) throw new ArgumentException("Search seconds must be between 0.1 and 300.");
        var limits = new SearchLimits(seconds, Whole("refine_laps", 500), Whole("stall_laps", 100), Whole("idle_batches", 64), Whole("cache_entries", DefaultCacheEntries, 100));
        if (limits.StallLaps >= limits.RefineLaps) throw new ArgumentException("Stall laps must be less than refinement laps.");
        return limits;
    }
}
