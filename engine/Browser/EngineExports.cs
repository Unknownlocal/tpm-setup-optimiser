using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using Tpm.Setup.Core;

/// <summary>Each worker owns its jobs. Close removes the complete cache/scenario graph.</summary>
[SupportedOSPlatform("browser")]
public static partial class EngineExports
{
    static readonly Dictionary<int, SearchJob> Jobs = [];
    public static void Main() { }

    [JSExport]
    public static int ContractVersion() => 1;

    [JSExport]
    public static int SearchContractVersion() => 1;

    [JSExport]
    public static double[] ResolveTemperature(string json, double seed) => SessionTemperature.Resolve(json, seed);

    [JSExport]
    public static double[] EvaluatePrepared(string json) => MotionModel.Prepared(json);

    [JSExport]
    public static void OpenJob(int id, string json)
    {
        if (Jobs.ContainsKey(id)) throw new ArgumentException("Calculation job is already open.");
        Jobs.Add(id, new SearchJob(json));
    }

    [JSExport]
    public static string PrepareJob(int id) { var job = Jobs[id]; job.PrepareStep(); return SearchSnapshot.Preparation(job); }

    [JSExport]
    public static bool StepJob(int id) => Jobs[id].SearchStep();

    [JSExport]
    public static string JobSnapshots(int id) => SearchSnapshot.All(Jobs[id]);

    [JSExport]
    public static void CloseJob(int id) { if (Jobs.Remove(id, out var job)) job.Dispose(); }

    [JSExport]
    public static int ActiveJobs() => Jobs.Count;
}
