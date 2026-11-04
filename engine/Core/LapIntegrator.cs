using System;

namespace Tpm.Setup.Core;

/// <summary>Closed flying lap in metres, seconds and m/s, using one-metre steps.
/// One motion model owns this workspace and calls it sequentially.</summary>
public sealed class LapIntegrator
{
    static readonly double[] Speeds = [0, 50, 100, 150, 200, 250, 300, 330, 350];
    static readonly double[] Rates = [1.75, 1.6, 1.45, 1.25, .95, .75, .4, .2, .05];
    readonly double[] nodes, old, entries, exits;

    public LapIntegrator(int sectors)
    {
        if (sectors <= 0) throw new ArgumentException("A lap needs at least one sector.");
        nodes = new double[sectors + 1]; old = new double[sectors + 1];
        entries = new double[sectors]; exits = new double[sectors];
    }

    static double Curve(double speed)
    {
        if (speed <= 0) return Rates[0];
        for (int i = 1; i < Speeds.Length; i++)
            if (speed < Speeds[i]) return Math.Max(.05, Rates[i - 1] + (Rates[i] - Rates[i - 1]) * ((speed - Speeds[i - 1]) / (Speeds[i] - Speeds[i - 1])));
        return .05;
    }

    static double Acceleration(double speed, double tail, double propulsion, double drag)
    {
        double fade = Math.Max(0, Math.Min(1, (speed - 5) / 15));
        double air = Math.Max(0, speed - tail * fade);
        return Math.Max(.05, propulsion * Curve(speed * 3.6) - drag * air * air);
    }

    public double Integrate(ReadOnlySpan<double> distances, ReadOnlySpan<double> caps, ReadOnlySpan<double> brakes, ReadOnlySpan<double> tails, double propulsion, double drag, bool windy)
    {
        int n = caps.Length, start = 0;
        if (n != entries.Length || distances.Length != n || brakes.Length != n || tails.Length != n)
            throw new ArgumentException("Lap sector arrays must match the workspace size.");
        if (!double.IsFinite(propulsion) || propulsion <= 0 || !double.IsFinite(drag) || drag < 0)
            throw new ArgumentException("Invalid propulsion or drag.");
        for (int i = 0; i < n; i++)
            if (!double.IsFinite(distances[i]) || distances[i] <= 0 || !double.IsFinite(caps[i]) || caps[i] < .5
                || !double.IsFinite(brakes[i]) || brakes[i] <= 0 || !double.IsFinite(tails[i]))
                throw new ArgumentException("Invalid lap sector values.");
        for (int i = 1; i < n; i++) if (caps[i] < caps[start]) start = i;
        Array.Fill(nodes, caps[start]);
        for (int iteration = 0; iteration < 12; iteration++)
        {
            Array.Copy(nodes, old, nodes.Length);
            nodes[0] = Math.Min(nodes[0], caps[start]);
            for (int i = 0; i < n; i++)
            {
                int source = (start + i) % n;
                double cap = caps[source], distance = distances[source], speed = Math.Min(nodes[i], cap), travelled = 0;
                while (travelled < distance - 1e-9 && speed < cap - 1e-9)
                {
                    double step = Math.Min(1, distance - travelled);
                    speed = Math.Min(cap, Math.Sqrt(Math.Max(0, speed * speed + 2 * Acceleration(speed, tails[source], propulsion, drag) * step)));
                    travelled += step;
                }
                nodes[i + 1] = Math.Min(cap, speed);
            }
            nodes[n] = Math.Min(Math.Min(nodes[n], nodes[0]), caps[start]);
            for (int i = n - 1; i >= 0; i--)
            {
                int source = (start + i) % n;
                double speed = Math.Min(nodes[i + 1], caps[source]);
                double maximum = Math.Sqrt(Math.Max(0, speed * speed + 2 * brakes[source] * distances[source]));
                nodes[i] = Math.Min(Math.Min(nodes[i], caps[source]), maximum);
            }
            nodes[n] = Math.Min(nodes[n], nodes[0]);
            bool same = true;
            for (int i = 0; i <= n; i++) if (nodes[i] != old[i]) { same = false; break; }
            if (same) break;
        }
        for (int i = 0; i < n; i++) { entries[(start + i) % n] = nodes[i]; exits[(start + i) % n] = nodes[i + 1]; }
        double lap = 0;
        for (int i = 0; i < n; i++)
        {
            double distance = distances[i], brake = brakes[i], cap = caps[i];
            double speed = Math.Max(.5, entries[i]), travelled = 0, duration = 0;
            while (travelled < distance - 1e-9)
            {
                double step = Math.Min(1, distance - travelled);
                double needed = Math.Max(0, (speed * speed - exits[i] * exits[i]) / (2 * brake));
                double rate = needed >= Math.Max(0, distance - travelled - step * .5) ? -brake
                    : speed >= cap - 1e-9 ? 0 : Acceleration(speed, tails[i], propulsion, drag);
                double next = Math.Sqrt(Math.Max(0, speed * speed + 2 * rate * step));
                if (rate >= 0) next = Math.Min(cap, next);
                duration += step / Math.Max(.1, .5 * (speed + next));
                travelled += step; speed = Math.Max(.5, next);
            }
            lap += windy ? duration : Math.Max(.001, duration);
        }
        return Math.Max(.001, lap);
    }
}
