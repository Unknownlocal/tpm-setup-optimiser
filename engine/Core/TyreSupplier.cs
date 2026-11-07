using System;
using System.Text.Json;
using static Tpm.Setup.Core.JsonValues;

namespace Tpm.Setup.Core;

/// <summary>Saved supplier ratings and the team's contract bonus for one compound.</summary>
public readonly record struct TyreSupplier(double Lateral, double Longitudinal, double Tolerance, double ContractGrip)
{
    public static TyreSupplier Read(JsonElement source, string compound)
    {
        var supplier = At(source, "tyreSupplier");
        double Rating(string key)
        {
            var values = At(supplier, key);
            if (values.ValueKind == JsonValueKind.Object)
                return Clamp(Required(At(values, compound), $"tyre supplier {key}/{compound}"), 1, 100);
            // Old saves stored a single pace delta for both grip axes.
            if (key is "lateral_grip" or "longitudinal_grip" && Has(supplier, "pace"))
            {
                double pace = Required(At(At(supplier, "pace"), compound), $"tyre supplier pace/{compound}");
                return Clamp(pace is >= 1 and <= 100 ? pace : 50 - pace * 100, 1, 100);
            }
            throw new ArgumentException($"Missing tyre supplier {key} ratings for {compound}.");
        }
        var contract = At(At(source, "teamInputs"), "tyre_contract");
        string type = Text(At(contract, "type"));
        if (type.Length == 0) throw new ArgumentException("Missing saved tyre contract type.");
        double bonus = 1;
        if (type is "works" or "partner")
        {
            if (At(contract, "bonus_grip_mult").ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
                bonus = OrNumber(At(contract, "bonus_grip_mult"), 1);
            else if (type == "works" ? Number(At(contract, "funding_weekly_m")) > 0
                     : At(contract, "bonus_pace").ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
                bonus = 1.0005;
        }
        return new(Rating("lateral_grip"), Rating("longitudinal_grip"), Rating("temperature_tolerance"), bonus > 0 ? bonus : 1);
    }
}
