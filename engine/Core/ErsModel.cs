using System;
using System.Linq;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Fixed balanced-mode hotlap assistance from the legal fitted ERS.
/// A projected hotlap starts charged; no multi-lap battery use or failures are simulated.</summary>
public sealed class ErsModel
{
    readonly JsonElement policy, config;
    readonly string mode;
    readonly double maximumCoverage;

    public ErsModel(JsonElement source)
    {
        policy = At(At(source, "activePolicies"), "ers");
        if (policy.ValueKind != JsonValueKind.Object) throw new ArgumentException("Missing active ERS regulation.");
        config = At(At(source, "definitions"), "ers_development");
        if (config.ValueKind != JsonValueKind.Object) throw new ArgumentException("Missing ers_development.json definitions.");
        string raw = Text(At(policy, "ers_mode"), Text(At(policy, "mode"))).Trim().ToLowerInvariant();
        mode = At(policy, "ers_enabled").ValueKind == JsonValueKind.False ? "banned"
            : raw is "open" or "open_development" or "development" ? "open"
            : raw is "spec" or "standard" or "standardized" or "standardised" or "enabled" ? "spec"
            : Flag(At(policy, "open_development")) ? "open" : "spec";
        maximumCoverage = mode == "open" ? ErsTrack.MaximumCoverage(At(source, "track")) : 1;
    }

    public double Bonus(JsonElement driver)
    {
        if (mode == "banned") return 0;
        JsonElement stats = default;
        if (mode == "open")
        {
            stats = At(At(Items(At(driver, "parts")).FirstOrDefault(part => Text(At(part, "category")) == "ers"), "item"), "stats");
            if (stats.ValueKind != JsonValueKind.Object) throw new ArgumentException($"{Text(At(driver, "name"))}: missing fitted ERS statistics.");
        }
        double Stat(string name, double standard) => mode == "open" ? Required(At(stats, name), $"ERS {name}") : standard;
        double Limit(string name, double fallback)
        {
            // Direct regulation fields override nested limits, then pack limits.
            var value = At(policy, name);
            if (name == "harvest_mj_efficiency" && Has(policy, "harvest__mj_efficiency")) value = At(policy, "harvest__mj_efficiency");
            if (value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) value = At(At(policy, "limits"), name);
            if (value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) value = At(At(config, "regulation_limits"), name);
            return Number(value, fallback);
        }
        // Spec statistics are fixed by the game; open equipment is clamped to
        // the same legal limits. Condition affects failures, not hotlap output.
        double capacity = Math.Max(0, Math.Min(Stat("capacity_mj", 4), Limit("capacity_cap_mj", 8)));
        double cost = Math.Max(Math.Max(.01, Limit("deploy_mj_efficiency", .5)), Math.Min(10, Stat("deploy_mj_efficiency", 1)));
        double harvest = Math.Max(0, Math.Min(Stat("harvest_mj_efficiency", 1), Limit("harvest_mj_efficiency", 1.5)));
        double output = Math.Max(0, Math.Min(Stat("acceleration_multiplier", 1), Limit("acceleration_multiplier", 2.5)));
        var energy = At(config, "mode_energy_balance");
        bool dynamic = mode == "open" && At(energy, "enabled").ValueKind != JsonValueKind.False;
        double deployment = 2 * cost, coverage = 1;
        if (dynamic)
        {
            var target = At(energy, "balanced_target_net_recovery_mj_per_lap");
            if (target.ValueKind == JsonValueKind.Undefined) target = At(energy, "balanced_max_net_recovery_mj_per_lap");
            deployment = Math.Min(4, Math.Max(0, 2 * harvest - Math.Max(0, Number(target, .25))));
            coverage = Math.Min(maximumCoverage, deployment / cost / 2);
        }
        if (deployment <= 1e-9 || capacity <= 1e-9) return 0;
        return Math.Max(0, 40 * Clamp(capacity / Math.Max(1e-9, deployment), 0, 1) * coverage * output);
    }
}
