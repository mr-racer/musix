using System.IO.Compression;

namespace Musix.Core.Playback;

/// <summary>
/// The scrubber's bars from `/tracks/{id}/envelope`: zlib of uint8 frames × 4 bands at 10 fps
/// (phase 4 §4), the web player's formula. The bands are weighted bass-first. The tallest bar is 1,
/// and the shortest is 0.12, so silence still reads as a line.
/// </summary>
public static class Envelope
{
    public static double[] Bars(byte[] zlib, int bars = 96)
    {
        using var z = new ZLibStream(new MemoryStream(zlib), CompressionMode.Decompress);
        using var raw = new MemoryStream();
        z.CopyTo(raw);
        var env = raw.GetBuffer();
        var frames = (int)(raw.Length / 4);
        var out_ = new double[bars];
        if (frames == 0) return out_.Select(_ => 0.12).ToArray();
        for (var b = 0; b < bars; b++)
        {
            int from = b * frames / bars, to = Math.Max(from + 1, (b + 1) * frames / bars);
            double sum = 0;
            for (var f = from; f < to && f < frames; f++)
                sum += env[f * 4] * 0.4 + env[f * 4 + 1] * 0.3 + env[f * 4 + 2] * 0.2 + env[f * 4 + 3] * 0.1;
            out_[b] = sum / (to - from) / 255;
        }
        var max = Math.Max(0.05, out_.Max());
        return out_.Select(h => 0.12 + 0.88 * (h / max)).ToArray();
    }
}
