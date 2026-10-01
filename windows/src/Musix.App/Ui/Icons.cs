using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Path = Microsoft.UI.Xaml.Shapes.Path;

namespace Musix.App.Ui;

/// <summary>
/// The web's icons (web/src/ui/icons.tsx: v1 main.jsx's 24×24 stroke paths). Segoe Fluent has
/// no flame, and v1's player is recognisable by these shapes, so the player draws them
/// itself and doesn't use the nearest glyph.
/// </summary>
public sealed class Icon : Grid
{
    private static readonly Dictionary<string, (string[] D, double W, int[] Fill)> Defs = new()
    {
        ["Fire"] = (["M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"], 2, []),
        ["Water"] = (["M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"], 2, []),
        ["Plus"] = (["M12 5v14", "M5 12h14"], 2, []),
        ["Lyrics"] = (["M4 7h16", "M4 12h16", "M4 17h10"], 2, []),
        ["Shuffle"] = (["M16 3h5v5", "M4 20 21 3", "M21 16v5h-5", "m15 15 6 6", "m4 4 5 5"], 2, []),
        ["Volume"] = (["M11 5 6 9H3v6h3l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"], 1.8, []),
        ["Devices"] = (["M3 5h10v14H3z", "M6.5,14.5a1.5,1.5 0 1,0 3,0a1.5,1.5 0 1,0 -3,0", "M7 8.5h2", "M16 9h5v10h-5z", "M18.5 16.5h.01"], 1.8, []),
        ["ChevronLeft"] = (["m15 18-6-6 6-6"], 2, []),
        ["ChevronRight"] = (["m9 18 6-6-6-6"], 2, []),
        ["ChevronDown"] = (["m6 9 6 6 6-6"], 2, []),
        ["Play"] = (["M7 4.5v15l12.5-7.5z"], 1.8, [0]),
        ["Pause"] = (["M6 4h4v16H6z", "M14 4h4v16h-4z"], 1.8, [0, 1]),
        ["Close"] = (["M18 6 6 18", "M6 6l12 12"], 2, []),
        ["Info"] = (["M3,12a9,9 0 1,0 18,0a9,9 0 1,0 -18,0", "M12 11v5", "M12 8h.01"], 1.8, []),
    };

    private readonly List<Path> paths = [];

    public Icon(string name, double size = 20, Brush? brush = null)
    {
        Width = Height = size;
        var (ds, w, fill) = Defs[name];
        var canvas = new Canvas { Width = 24, Height = 24 };
        for (var i = 0; i < ds.Length; i++)
        {
            var p = new Path { Data = (Geometry)XamlBindingHelper.ConvertValue(typeof(Geometry), ds[i]) };
            if (fill.Contains(i)) p.Tag = "fill";
            else { p.StrokeThickness = w; p.StrokeStartLineCap = p.StrokeEndLineCap = PenLineCap.Round; p.StrokeLineJoin = PenLineJoin.Round; }
            paths.Add(p);
            canvas.Children.Add(p);
        }
        Children.Add(new Viewbox { Child = canvas });
        Brush = brush ?? Theme.B("MxTextMuted");
    }

    public Brush Brush
    {
        set { foreach (var p in paths) { if (p.Tag is "fill") p.Fill = value; else p.Stroke = value; } }
    }

    /// <summary>v1's Lossless mark, the waveform (viewBox 15×9).</summary>
    public static Viewbox Lossless(double height, Brush brush) => new()
    {
        Height = height,
        Child = new Canvas
        {
            Width = 15, Height = 9,
            Children =
            {
                new Path
                {
                    Fill = brush,
                    Data = (Geometry)XamlBindingHelper.ConvertValue(typeof(Geometry), "M8.184,0.35C9.944,0.35 10.703,3.296 11.338,5.238C11.673,3.842 11.497,3.542 11.857,3.542C11.99,3.542 12.126,3.633 12.126,3.798C12.126,3.809 12.123,3.839 12.117,3.883L12.091,4.058C12.02,4.522 11.845,5.494 11.654,6.144C13.198,10.191 14.345,4.861 14.474,3.772C14.493,3.615 14.612,3.542 14.731,3.542C14.891,3.542 15.022,3.662 14.997,3.843C14.72,5.605 14.295,8.35 12.547,8.35C11.582,8.35 11.04,7.595 10.611,6.73C9.54,4.626 9.047,1.093 7.997,1.093C7.66,1.093 7.411,1.444 7.394,1.444C7.362,1.444 7.337,1.301 7.023,0.909C7.322,0.567 7.734,0.35 8.184,0.35ZM2.458,0.354C5.211,0.354 5.456,7.618 7.014,7.618C7.197,7.618 7.394,7.507 7.61,7.256C7.729,7.458 7.851,7.638 7.978,7.796C7.667,8.151 7.28,8.35 6.795,8.35C5.054,8.349 4.306,5.434 3.663,3.466C3.511,4.097 3.432,4.669 3.402,4.925C3.382,5.088 3.263,5.163 3.143,5.163C3.009,5.163 2.874,5.071 2.874,4.908L2.874,4.908L2.877,4.87C2.966,4.223 3.146,3.243 3.347,2.56C3.079,1.858 2.745,1.091 2.252,1.091C1.257,1.091 0.687,3.591 0.527,4.925C0.508,5.088 0.388,5.163 0.268,5.163C0.135,5.163 0,5.071 0,4.908C0,4.896 0.001,4.883 0.002,4.87C0.283,2.836 0.808,0.354 2.458,0.354ZM5.315,0.35C5.809,0.35 6.339,0.608 6.797,1.211C6.822,1.241 7.078,1.639 7.159,1.777C8.277,3.802 8.818,7.627 9.881,7.627C10.065,7.627 10.264,7.513 10.484,7.256C10.604,7.458 10.726,7.638 10.852,7.796C10.542,8.15 10.155,8.35 9.67,8.35C6.933,8.349 6.636,1.09 5.128,1.09C4.788,1.09 4.536,1.444 4.519,1.444C4.487,1.444 4.462,1.301 4.148,0.909C4.455,0.558 4.87,0.35 5.315,0.35Z"),
                },
            },
        },
    };
}
