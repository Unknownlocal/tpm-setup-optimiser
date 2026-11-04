using System;

namespace Tpm.Setup.Core;

/// <summary>A completed candidate or one shared dry result. Cached rows never retain motion arrays.</summary>
public sealed class LapResult
{
    public required string Compound { get; init; }
    public required double[] Settings { get; init; }
    public double Balance { get; init; }
    public double Traction { get; init; }
    public double Temperature { get; init; }
    public double Lateral { get; init; }
    public double Longitudinal { get; init; }
    public double Preference { get; private set; }
    public double Pace { get; private set; }
    public double Delta { get; private set; }
    public double Score { get; private set; }
    public int Grade { get; private set; }
    public double Lap { get; init; }
    public ReferenceResult? Reference { get; private set; }
    public LapInput? Inputs { get; init; }
    public LapResult[]? Components { get; private init; }

    public LapResult Assess(double balancePreference, double tractionPreference, ReferenceResult reference)
    {
        var assessment = SetupGrading.Assess(Balance, Traction, Lap, balancePreference, tractionPreference, reference.Lap);
        Preference = assessment.Preference; Pace = assessment.Pace; Delta = assessment.Delta; Score = assessment.Score; Grade = assessment.Grade; Reference = reference;
        return this;
    }
    public static LapResult Average(LapResult[] rows)
    {
        var average = SetupGrading.Average(rows[0].Score, rows[1].Score, rows[2].Score);
        return new() { Compound = "avg_dry", Settings = rows[0].Settings, Score = average.Score, Grade = average.Grade, Components = rows };
    }
}

public sealed record ReferenceResult(double[] Settings, double Lap, int Evaluated);
