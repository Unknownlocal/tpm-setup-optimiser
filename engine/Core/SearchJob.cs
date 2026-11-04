using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Own every entry assigned to one worker. Disposal releases all search/reference state.</summary>
public sealed class SearchJob : IDisposable
{
    public List<DriverSearch> Drivers { get; } = [];
    public bool GradeOnly { get; }
    public bool Prepared => preparationIndex == Drivers.Count;
    public DriverSearch? Checkpoint { get; private set; }
    public DriverSearch? Preparing => Prepared ? null : Drivers[preparationIndex];
    public int CacheEntries => Drivers.Sum(driver => driver.CacheEntries);
    IEnumerator<int>? preparation, search;
    int preparationIndex, cursor;
    bool disposed;

    public SearchJob(string json)
    {
        using var document = JsonDocument.Parse(json); var root = document.RootElement; var source = At(root, "source"); var payload = At(root, "payload");
        if (Number(At(source, "version")) != 1 || Text(At(source, "setupModel")) != "formula") throw new ArgumentException("Only the verified Formula scenario is supported.");
        var profile = At(At(source, "activePolicies"), "car");
        foreach (string key in new[] { "corner_speed_multiplier", "acceleration_multiplier", "braking_multiplier", "drag_multiplier" })
            if (LapInput.Need(At(profile, key), key) != 1) throw new ArgumentException("This lap preview currently supports the standard car profile only.");
        int seed = SessionTemperature.Seed(Number(At(payload, "seed")));
        GradeOnly = Text(At(root, "mode")) == "grade";
        var limits = GradeOnly ? new SearchLimits() : SearchLimits.Read(At(payload, "search"));
        var drivers = Items(At(source, "drivers")).ToArray();
        var names = Items(At(root, "names")).Select(value => Text(value)).ToArray();
        if (names.Length == 0 || names.Distinct().Count() != names.Length) throw new ArgumentException("A worker needs distinct driver entries.");
        var cars = SavedCar.Build(source); var conditions = SessionConditions.Build(source, seed, Text(At(payload, "trackId")), Flag(At(payload, "testing")));
        var motion = new MotionModel(At(source, "track"), profile, conditions.Wind);
        foreach (string name in names)
        {
            int index = Array.FindIndex(drivers, driver => Text(At(driver, "name")) == name);
            if (index < 0) throw new ArgumentException("The entry is missing from the prepared save.");
            Drivers.Add(new(new(source, drivers[index], index, cars, conditions, motion, !GradeOnly), limits, seed));
        }
    }

    /// <summary>Advance at most one reference/candidate batch and expose only completed driver checkpoints.</summary>
    public bool PrepareStep()
    {
        ObjectDisposedException.ThrowIf(disposed, this); Checkpoint = null;
        if (Prepared) return true;
        preparation ??= Drivers[preparationIndex].Prepare(GradeOnly).GetEnumerator();
        if (!preparation.MoveNext())
        {
            preparation.Dispose(); preparation = null; Checkpoint = Drivers[preparationIndex++];
        }
        return Prepared;
    }

    /// <summary>Coalesce cached rounds, returning at batch boundaries after 16 laps or roughly 8 ms.
    /// The browser checks its shared deadline and cancellation between these slices.</summary>
    public bool SearchStep()
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        if (!Prepared || GradeOnly) throw new InvalidOperationException("Search preparation is incomplete.");
        var clock = Stopwatch.StartNew(); int initialLaps = Drivers.Sum(driver => driver.Stats.Evaluated);
        do
        {
            if (search == null)
            {
                if (!Drivers.Any(driver => driver.HasActive)) return false;
                search = Drivers[cursor++ % Drivers.Count].Step().GetEnumerator();
            }
            if (!search.MoveNext()) { search.Dispose(); search = null; }
        }
        while (Drivers.Sum(driver => driver.Stats.Evaluated) - initialLaps < 16 && clock.Elapsed.TotalMilliseconds < 8);
        return Drivers.Any(driver => driver.HasActive);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true; preparation?.Dispose(); preparation = null; search?.Dispose(); search = null;
        foreach (var driver in Drivers) driver.Dispose(); Drivers.Clear(); Checkpoint = null;
    }
}
