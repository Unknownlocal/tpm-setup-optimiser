using System;
using System.IO;
using System.Text;
using System.Text.Json;

namespace Tpm.Setup.Core;

/// <summary>Write only completed result metadata across the browser boundary; caches stay native.</summary>
public static class SearchSnapshot
{
    static string Json(Action<Utf8JsonWriter> write)
    {
        using var stream = new MemoryStream(); using (var writer = new Utf8JsonWriter(stream)) write(writer);
        return Encoding.UTF8.GetString(stream.ToArray());
    }
    public static string Preparation(SearchJob job) => Json(writer =>
    {
        writer.WriteStartObject(); writer.WriteBoolean("complete", job.Prepared);
        if (job.Checkpoint is { } checkpoint) { writer.WritePropertyName("snapshot"); Driver(writer, checkpoint, job.GradeOnly); }
        if (job.Preparing is { CurrentReference: not null } driver)
        { writer.WriteStartObject("reference"); writer.WriteString("driver", driver.Scenario.Name); writer.WriteString("compound", driver.CurrentReference); writer.WriteEndObject(); }
        writer.WriteEndObject();
    });
    public static string All(SearchJob job) => Json(writer =>
    {
        writer.WriteStartArray(); foreach (var driver in job.Drivers) if (driver.Ready) Driver(writer, driver, job.GradeOnly); writer.WriteEndArray();
    });

    static void Settings(Utf8JsonWriter writer, string name, double[] settings)
    {
        writer.WriteStartObject(name); for (int i = 0; i < SettingSpace.Keys.Length; i++) writer.WriteNumber(SettingSpace.Keys[i], settings[i]); writer.WriteEndObject();
    }
    static void Driver(Utf8JsonWriter writer, DriverSearch driver, bool gradeOnly)
    {
        var scenario = driver.Scenario; var stats = driver.Stats;
        writer.WriteStartObject(); writer.WriteString("driver", scenario.Name); writer.WriteNumber("entry", scenario.Entry);
        writer.WriteStartObject("wind"); writer.WriteNumber("speed_kmh", scenario.WindSpeed); writer.WriteNumber("direction_deg", scenario.WindDirection); writer.WriteEndObject();
        writer.WriteStartObject("statistics");
        if (!gradeOnly) { writer.WriteNumber("evaluated", stats.Evaluated); writer.WriteNumber("cached", stats.Cached); writer.WriteNumber("pruned", stats.Pruned); writer.WriteNumber("preparation_laps", stats.PreparationLaps); }
        writer.WriteNumber("reference_laps", stats.ReferenceLaps); writer.WriteEndObject();
        writer.WriteStartArray("rows");
        if (gradeOnly) foreach (var row in driver.Graded) Row(writer, row, scenario, null);
        else foreach (var state in driver.Cases)
        {
            // Preserve a better component found through AVG_DRY, even after its own case stopped.
            var known = state.Scorer.BestKnown; var best = known != null && known.Score > state.Best.Score ? known : state.Best;
            Row(writer, best, scenario, state);
        }
        writer.WriteEndArray(); writer.WriteEndObject();
    }
    static void Row(Utf8JsonWriter writer, LapResult row, DriverScenario scenario, SearchCase? state)
    {
        writer.WriteStartObject(); writer.WriteString("driver", scenario.Name); writer.WriteNumber("entry", scenario.Entry); writer.WriteString("compound", row.Compound);
        Settings(writer, "settings", row.Settings); writer.WriteNumber("score", row.Score); writer.WriteString("grade", SetupGrading.Labels()[row.Grade]);
        if (row.Components is { } components)
        {
            writer.WriteStartObject("compound_scores"); foreach (var component in components) writer.WriteNumber(component.Compound, component.Score); writer.WriteEndObject();
            writer.WriteStartObject("compound_lap_times_s"); foreach (var component in components) writer.WriteNumber(component.Compound, component.Lap); writer.WriteEndObject();
        }
        else
        {
            writer.WriteNumber("balance", row.Balance); writer.WriteNumber("traction", row.Traction); writer.WriteNumber("tyre_temperature_c", row.Temperature);
            writer.WriteNumber("preference_score", row.Preference); writer.WriteNumber("maximum_score", scenario.Weights.Combine(100, row.Preference)); writer.WriteNumber("pace_score", row.Pace); writer.WriteNumber("pace_delta_s", row.Delta); writer.WriteNumber("lap_time_s", row.Lap);
            writer.WriteStartArray("tyre_grip"); writer.WriteNumberValue(row.Lateral); writer.WriteNumberValue(row.Longitudinal); writer.WriteEndArray();
            if (row.Inputs is { } input) { writer.WritePropertyName("inputs"); input.Write(writer); }
            if (row.Reference is { } reference) { writer.WriteNumber("reference_lap_s", reference.Lap); Settings(writer, "reference_settings", reference.Settings); }
        }
        if (state != null)
        {
            writer.WriteString("stop_reason", state.StopReason);
            if (state.Progress is not { } progress) writer.WriteNull("refinement");
            else
            {
                writer.WriteStartObject("refinement"); writer.WriteNumber("laps", progress.Laps); writer.WriteNumber("stale_laps", progress.StaleLaps); writer.WriteNumber("idle_batches", progress.IdleBatches);
                writer.WriteNumber("milestone", progress.Milestone); writer.WriteNumber("first_score", progress.FirstScore); writer.WriteEndObject();
            }
        }
        writer.WriteEndObject();
    }
}
