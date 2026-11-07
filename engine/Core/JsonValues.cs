using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Tpm.Setup.Core;

/// <summary>Read local simulation projections without reflection or file access.</summary>
internal static class JsonValues
{
    public static JsonElement At(JsonElement value, string key) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var found) ? found : default;

    public static bool Has(JsonElement value, string key) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out _);

    public static bool Nonempty(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object && value.EnumerateObject().MoveNext();

    public static IEnumerable<JsonElement> Items(JsonElement value) =>
        value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : Array.Empty<JsonElement>();

    public static string Text(JsonElement value, string fallback = "") =>
        value.ValueKind == JsonValueKind.String ? value.GetString()! : fallback;

    public static double Number(JsonElement value, double fallback = 0)
    {
        if (value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) return fallback;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out double number) || !double.IsFinite(number))
            throw new ArgumentException("Saved car definitions need finite numbers.");
        return number;
    }

    // A few native fields use a truthy fallback: an explicit zero selects the default.
    public static double OrNumber(JsonElement value, double fallback)
    {
        double number = Number(value);
        return number != 0 ? number : fallback;
    }
    public static double Required(JsonElement value, string label) =>
        value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? throw new ArgumentException($"Missing {label}.") : Number(value);
    public static bool Flag(JsonElement value) => value.ValueKind == JsonValueKind.True;
    public static double Clamp(double value, double low, double high) => Math.Max(low, Math.Min(high, value));

    public static Dictionary<string, double> Numbers(JsonElement value)
    {
        var result = new Dictionary<string, double>();
        if (value.ValueKind == JsonValueKind.Object)
            foreach (var property in value.EnumerateObject()) result[property.Name] = Number(property.Value);
        return result;
    }
}
