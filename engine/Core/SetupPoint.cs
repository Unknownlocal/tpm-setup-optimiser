using System;

namespace Tpm.Setup.Core;

/// <summary>Immutable integer coordinates in the prepared setup-axis order.</summary>
public readonly record struct SetupPoint(long A, long B, long C, long D, long E)
{
    public long this[int axis] => axis switch { 0 => A, 1 => B, 2 => C, 3 => D, 4 => E, _ => throw new ArgumentOutOfRangeException(nameof(axis)) };
    public SetupPoint With(int axis, long value) => axis switch
    {
        0 => this with { A = value }, 1 => this with { B = value }, 2 => this with { C = value }, 3 => this with { D = value }, 4 => this with { E = value }, _ => throw new ArgumentOutOfRangeException(nameof(axis)),
    };
}
