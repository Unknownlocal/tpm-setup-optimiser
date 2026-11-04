namespace Tpm.Setup.Core;

/// <summary>Physical candidate laps, reused/pruned candidates and reference preparation are separate counts.</summary>
public sealed class SearchStats
{
    public int Evaluated, Cached, Pruned, ReferenceLaps, PreparationLaps;
}
