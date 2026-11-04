using System.Collections.Generic;

namespace Tpm.Setup.Core;

public readonly record struct CandidateRow(SetupPoint Point, LapResult Row);

/// <summary>One compound or a shared dry objective; iterators yield after each physical batch.</summary>
public interface CandidateScorer
{
    LapResult? BestKnown { get; }
    IEnumerable<int> Evaluate(IEnumerable<SetupPoint> points, double incumbent, List<CandidateRow> found);
}
