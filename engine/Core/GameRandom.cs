using System;
using System.Collections.Generic;

namespace Tpm.Setup.Core;

/// <summary>Integer-seeded MT19937 and draw rules used by the game's Python runtime.</summary>
public sealed class GameRandom
{
    readonly uint[] state = new uint[624];
    int index = 624;

    public GameRandom(ulong seed)
    {
        uint[] keys = seed > uint.MaxValue ? [(uint)seed, (uint)(seed >> 32)] : [(uint)seed];
        unchecked
        {
            state[0] = 19650218;
            for (int k = 1; k < 624; k++) state[k] = 1812433253 * (state[k - 1] ^ (state[k - 1] >> 30)) + (uint)k;
            int i = 1, j = 0;
            for (int count = Math.Max(624, keys.Length); count > 0; count--)
            {
                state[i] = (state[i] ^ (state[i - 1] ^ (state[i - 1] >> 30)) * 1664525) + keys[j] + (uint)j;
                if (++i == 624) { state[0] = state[623]; i = 1; }
                if (++j == keys.Length) j = 0;
            }
            for (int count = 623; count > 0; count--)
            {
                state[i] = (state[i] ^ (state[i - 1] ^ (state[i - 1] >> 30)) * 1566083941) - (uint)i;
                if (++i == 624) { state[0] = state[623]; i = 1; }
            }
            state[0] = 0x80000000;
        }
    }

    public uint NextWord()
    {
        if (index == 624)
        {
            for (int i = 0; i < 624; i++)
            {
                uint y = (state[i] & 0x80000000) | (state[(i + 1) % 624] & 0x7fffffff);
                state[i] = state[(i + 397) % 624] ^ (y >> 1) ^ ((y & 1) != 0 ? 0x9908b0df : 0);
            }
            index = 0;
        }
        uint value = state[index++];
        value ^= value >> 11; value ^= (value << 7) & 0x9d2c5680; value ^= (value << 15) & 0xefc60000; value ^= value >> 18;
        return value;
    }

    public double Random() => ((NextWord() >> 5) * 67108864.0 + (NextWord() >> 6)) / 9007199254740992.0;
    public double Uniform(double low, double high) => low + (high - low) * Random();

    public int Integer(int low, int high)
    {
        long size = (long)high - low + 1;
        if (size < 1 || size > uint.MaxValue) throw new ArgumentException("Invalid random integer range.");
        int bits = 0; for (long n = size; n > 0; n >>= 1) bits++;
        uint value; do { value = NextWord() >> (32 - bits); } while (value >= size);
        return (int)(low + (long)value);
    }

    public int[] SampleIndices(int size, int count)
    {
        if (count < 0 || count > size) throw new ArgumentException("Invalid random sample size.");
        var selected = new int[count];
        double threshold = 21 + (count > 5 ? Math.Pow(4, Math.Ceiling(Math.Log(count * 3) / Math.Log(4))) : 0);
        if (size > threshold)
        {
            var used = new HashSet<int>();
            for (int i = 0; i < count; i++) { int next; do { next = Integer(0, size - 1); } while (!used.Add(next)); selected[i] = next; }
        }
        else
        {
            var pool = new int[size]; for (int i = 0; i < size; i++) pool[i] = i;
            for (int i = 0; i < count; i++) { int next = Integer(0, size - i - 1); selected[i] = pool[next]; pool[next] = pool[size - i - 1]; }
        }
        return selected;
    }

}
