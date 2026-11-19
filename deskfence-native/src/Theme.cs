using System;
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows.Media;

namespace DeskFence
{
    /// <summary>Fence colours and sizes, read from the same style object the Electron version saved.</summary>
    internal static class Theme
    {
        public static JsonObject DefaultStyle() => new JsonObject
        {
            ["backgroundColor"] = "rgba(16, 20, 26, 0.86)",
            ["borderColor"] = "rgba(255, 255, 255, 0.12)",
            ["borderWidth"] = 1,
            ["opacity"] = 1,
            ["labelColor"] = "#ffffff",
            ["labelSize"] = 14,
            ["borderRadius"] = 6,
            ["iconPx"] = 34,
            ["itemLabelSize"] = 10,
        };

        // The blue look early versions gave every fence: shown with the current default instead
        static bool IsOldDefault(JsonObject s) =>
            Str(s["borderColor"]) == "#3b82f6" &&
            FenceData.Num(s["borderWidth"], 0) == 2 &&
            FenceData.Num(s["borderRadius"], 0) == 8 &&
            (Str(s["backgroundColor"]) == "rgba(30, 41, 59, 0.85)" || Str(s["backgroundColor"]) == "rgba(255, 255, 255, 0.88)");

        /// <summary>A JSON value as text, or null when it is missing or not text (never throws).</summary>
        public static string Str(JsonNode node) => node is JsonValue v && v.TryGetValue(out string s) ? s : null;

        public sealed class Look
        {
            public Color Background, Border, Label, TitleBar, TabActive, Tint;
            public double BorderWidth, Radius, Opacity, LabelSize, IconPx, ItemLabelSize, TintStrength;
            public bool HasTitleBar, TitleLeft, Shadow, CompactHeader;
            public int Columns;
        }

        public static Look Read(JsonObject style)
        {
            var s = style == null || IsOldDefault(style) ? DefaultStyle() : style;
            var look = new Look
            {
                Background = Parse(Str(s["backgroundColor"]), Color.FromArgb(219, 16, 20, 26)),
                Border = Parse(Str(s["borderColor"]), Color.FromArgb(31, 255, 255, 255)),
                Label = Parse(Str(s["labelColor"]), Colors.White),
                BorderWidth = FenceData.Num(s["borderWidth"], 1),
                Radius = FenceData.Num(s["borderRadius"], 6),
                Opacity = Math.Clamp(FenceData.Num(s["opacity"], 1), 0.2, 1),
                LabelSize = Math.Clamp(FenceData.Num(s["labelSize"], 14), 9, 30),
                IconPx = Math.Clamp(FenceData.Num(s["iconPx"], 34), 16, 128),
                ItemLabelSize = Math.Clamp(FenceData.Num(s["itemLabelSize"], 10), 8, 20),
                Columns = (int)FenceData.Num(s["columns"], 0),
                TitleLeft = Str(s["titleAlign"]) == "left",
                Shadow = !(s["shadow"] is JsonValue sh && sh.TryGetValue(out bool b) && !b),
                CompactHeader = s["compactHeader"] is JsonValue ch && ch.TryGetValue(out bool c) && c,
                TintStrength = Math.Clamp(FenceData.Num(s["iconTintStrength"], 0), 0, 1),
            };
            string bar = Str(s["titleBarColor"]);
            look.HasTitleBar = !string.IsNullOrEmpty(bar);
            look.TitleBar = Parse(bar, Colors.Transparent);
            look.TabActive = Parse(Str(s["tabColor"]), Color.FromArgb(38, 255, 255, 255));
            look.Tint = Parse(Str(s["iconTint"]), Colors.Transparent);
            return look;
        }

        static readonly Regex Rgba = new Regex(@"^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$", RegexOptions.IgnoreCase);

        /// <summary>"#rrggbb", "#rgb" or "rgba(r, g, b, a)" to a WPF colour.</summary>
        public static Color Parse(string text, Color fallback)
        {
            if (string.IsNullOrWhiteSpace(text)) return fallback;
            text = text.Trim();
            var m = Rgba.Match(text);
            if (m.Success)
            {
                byte r = (byte)Math.Min(255, int.Parse(m.Groups[1].Value));
                byte g = (byte)Math.Min(255, int.Parse(m.Groups[2].Value));
                byte b = (byte)Math.Min(255, int.Parse(m.Groups[3].Value));
                double a = m.Groups[4].Success ? double.Parse(m.Groups[4].Value, CultureInfo.InvariantCulture) : 1;
                return Color.FromArgb((byte)Math.Round(Math.Clamp(a, 0, 1) * 255), r, g, b);
            }
            if (Regex.IsMatch(text, "^#[0-9a-fA-F]{6}$"))
                return Color.FromRgb(Convert.ToByte(text.Substring(1, 2), 16), Convert.ToByte(text.Substring(3, 2), 16), Convert.ToByte(text.Substring(5, 2), 16));
            if (Regex.IsMatch(text, "^#[0-9a-fA-F]{3}$"))
                return Color.FromRgb(Convert.ToByte(new string(text[1], 2), 16), Convert.ToByte(new string(text[2], 2), 16), Convert.ToByte(new string(text[3], 2), 16));
            return fallback;
        }

        public static SolidColorBrush Brush(Color c)
        {
            var b = new SolidColorBrush(c);
            b.Freeze();
            return b;
        }
    }
}
