using System;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace DeskFence
{
    /// <summary>Customize one fence. Every change shows on the real fence at once; Cancel puts it back.</summary>
    internal sealed class CustomizeWindow : FluentWindow
    {
        readonly DeskFenceApp app;
        readonly FenceWindow fence;
        readonly string originalStyle, originalSize, originalName;
        JsonObject style;
        bool saved;

        static readonly Color[] PanelColors =
        {
            Color.FromRgb(16, 20, 26), Color.FromRgb(30, 41, 59), Color.FromRgb(23, 37, 84), Color.FromRgb(20, 83, 45),
            Color.FromRgb(76, 29, 149), Color.FromRgb(124, 45, 18), Color.FromRgb(127, 29, 29), Color.FromRgb(255, 255, 255),
        };
        static readonly Color[] AccentColors =
        {
            Colors.White, Color.FromRgb(59, 130, 246), Color.FromRgb(34, 197, 94), Color.FromRgb(234, 179, 8),
            Color.FromRgb(239, 68, 68), Color.FromRgb(168, 85, 247), Color.FromRgb(236, 72, 153), Color.FromRgb(20, 184, 166), Color.FromRgb(31, 41, 55),
        };

        static readonly (string Name, Action<JsonObject> Apply)[] Presets =
        {
            ("Classic", s => { s["backgroundColor"] = "rgba(16, 20, 26, 0.86)"; s["borderColor"] = "rgba(255, 255, 255, 0.12)"; s["labelColor"] = "#ffffff"; s["borderWidth"] = 1; s["borderRadius"] = 6; s.Remove("titleBarColor"); s.Remove("tabColor"); }),
            ("Glass", s => { s["backgroundColor"] = "rgba(255, 255, 255, 0.14)"; s["borderColor"] = "rgba(255, 255, 255, 0.35)"; s["labelColor"] = "#ffffff"; s["borderWidth"] = 1; s.Remove("titleBarColor"); }),
            ("Light", s => { s["backgroundColor"] = "rgba(255, 255, 255, 0.88)"; s["borderColor"] = "rgba(0, 0, 0, 0.12)"; s["labelColor"] = "#1f2937"; s["borderWidth"] = 1; s.Remove("titleBarColor"); s["tabColor"] = "rgba(0, 0, 0, 0.08)"; }),
            ("Slate", s => { s["backgroundColor"] = "rgba(30, 41, 59, 0.85)"; s["borderColor"] = "#3b82f6"; s["labelColor"] = "#ffffff"; s["borderWidth"] = 2; s["titleBarColor"] = "rgba(59, 130, 246, 0.25)"; }),
            ("Forest", s => { s["backgroundColor"] = "rgba(20, 83, 45, 0.8)"; s["borderColor"] = "#22c55e"; s["labelColor"] = "#ecfdf5"; s["borderWidth"] = 1; s["titleBarColor"] = "rgba(34, 197, 94, 0.2)"; }),
            ("Plum", s => { s["backgroundColor"] = "rgba(76, 29, 149, 0.8)"; s["borderColor"] = "#a78bfa"; s["labelColor"] = "#f5f3ff"; s["borderWidth"] = 1; s["titleBarColor"] = "rgba(167, 139, 250, 0.2)"; }),
            ("Ember", s => { s["backgroundColor"] = "rgba(124, 45, 18, 0.8)"; s["borderColor"] = "#fb923c"; s["labelColor"] = "#fff7ed"; s["borderWidth"] = 1; s["titleBarColor"] = "rgba(251, 146, 60, 0.2)"; }),
        };

        public CustomizeWindow(DeskFenceApp app, FenceWindow fence) : base("Customize “" + fence.Data.Name + "”", 460)
        {
            this.app = app;
            this.fence = fence;
            originalStyle = fence.Data.Style.ToJsonString();
            originalSize = fence.Data.Raw["size"]?.ToJsonString() ?? "{}";
            originalName = fence.Data.Name;
            // a fence still on the old blue default starts from the current look
            style = (JsonObject)JsonNode.Parse(originalStyle);
            var look = Theme.Read(style);
            if (Theme.Str(style["borderColor"]) == "#3b82f6" && FenceData.Num(style["borderWidth"], 0) == 2 && FenceData.Num(style["borderRadius"], 0) == 8) style = Theme.DefaultStyle();
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = SystemParameters.WorkArea.Right - Width - 24; // at the side, so the fence stays visible
            Top = SystemParameters.WorkArea.Top + 24;
            Build();
        }

        // ---- reading / writing the style ----
        Color ColorOf(string key, Color fallback) => Theme.Parse(Theme.Str(style[key]), fallback);
        double NumOf(string key, double fallback) => FenceData.Num(style[key], fallback);

        static string Css(Color c, double alpha) =>
            string.Format(CultureInfo.InvariantCulture, "rgba({0}, {1}, {2}, {3})", c.R, c.G, c.B, Math.Round(Math.Clamp(alpha, 0, 1), 2));
        static string Hex(Color c) => $"#{c.R:x2}{c.G:x2}{c.B:x2}";

        void Set(string key, JsonNode value)
        {
            if (value == null) style.Remove(key);
            else style[key] = value;
            Preview();
        }

        void Preview()
        {
            fence.Data.Raw["style"] = JsonNode.Parse(style.ToJsonString());
            fence.Refresh();
        }

        void Build()
        {
            var bg = ColorOf("backgroundColor", Color.FromArgb(219, 16, 20, 26));
            var border = ColorOf("borderColor", Color.FromArgb(31, 255, 255, 255));
            var bar = ColorOf("titleBarColor", Color.FromArgb(0, 255, 255, 255));
            var tab = ColorOf("tabColor", Color.FromArgb(38, 255, 255, 255));

            var presetPanel = new WrapPanel();
            foreach (var (name, apply) in Presets)
            {
                var sample = new JsonObject();
                apply(sample);
                var c = Theme.Parse(Theme.Str(sample["backgroundColor"]), Colors.Black);
                presetPanel.Children.Add(Chip(name, false, () => { apply(style); Preview(); Rebuild(); },
                    new SolidColorBrush(Color.FromRgb((byte)(c.R * c.A / 255 + 51 * (255 - c.A) / 255), (byte)(c.G * c.A / 255 + 65 * (255 - c.A) / 255), (byte)(c.B * c.A / 255 + 85 * (255 - c.A) / 255))),
                    new SolidColorBrush(Theme.Parse(Theme.Str(sample["labelColor"]), Colors.White))));
            }
            presetPanel.Children.Add(Chip("Reset", false, () => { style = Theme.DefaultStyle(); Preview(); Rebuild(); }));

            var corners = new StackPanel { Orientation = Orientation.Horizontal };
            foreach (var (name, radius) in new[] { ("Square", 0), ("Soft", 6), ("Rounded", 14), ("Round", 24) })
                corners.Children.Add(Chip(name, (int)NumOf("borderRadius", 6) == radius, () => { Set("borderRadius", radius); Rebuild(); }));

            var align = new StackPanel { Orientation = Orientation.Horizontal };
            align.Children.Add(Chip("Center", Theme.Str(style["titleAlign"]) != "left", () => { Set("titleAlign", "center"); Rebuild(); }));
            align.Children.Add(Chip("Left", Theme.Str(style["titleAlign"]) == "left", () => { Set("titleAlign", "left"); Rebuild(); }));

            var tint = ColorOf("iconTint", Color.FromRgb(59, 130, 246));
            var stack = new StackPanel();
            stack.Children.Add(Section("Look", presetPanel));
            stack.Children.Add(Section("Panel",
                Row("Colour", Swatches(PanelColors, bg, c => { bg = Color.FromArgb(bg.A, c.R, c.G, c.B); Set("backgroundColor", Css(c, bg.A / 255.0)); })),
                Row("Transparency", SliderRow(Math.Round((1 - bg.A / 255.0) * 100), 0, 100, 5, v => { bg = Color.FromArgb((byte)Math.Round((1 - v / 100) * 255), bg.R, bg.G, bg.B); Set("backgroundColor", Css(bg, bg.A / 255.0)); }, "%")),
                Row("Border colour", Swatches(AccentColors, border, c => { border = Color.FromArgb(Math.Max(border.A, (byte)40), c.R, c.G, c.B); Set("borderColor", Css(border, border.A / 255.0)); })),
                Row("Border width", SliderRow(NumOf("borderWidth", 1), 0, 6, 1, v => Set("borderWidth", v), " px")),
                Row("Corners", corners),
                Row("Corner radius", SliderRow(NumOf("borderRadius", 6), 0, 30, 1, v => Set("borderRadius", v), " px")),
                Row("Shadow", Switch(!(style["shadow"] is JsonValue sv && sv.TryGetValue(out bool sb) && !sb), on => Set("shadow", on))),
                Row("Whole fence opacity", SliderRow(Math.Round(NumOf("opacity", 1) * 100), 20, 100, 5, v => Set("opacity", v / 100), "%"), "Fades the icons too; Transparency fades only the background")));
            stack.Children.Add(Section("Title and tabs",
                Row("Title colour", Swatches(AccentColors, ColorOf("labelColor", Colors.White), c => Set("labelColor", Hex(c)))),
                Row("Title size", SliderRow(NumOf("labelSize", 14), 10, 24, 1, v => Set("labelSize", v), " px")),
                Row("Title position", align),
                Row("Title bar colour", Swatches(AccentColors, bar, c => { bar = Color.FromArgb(Math.Max(bar.A, (byte)70), c.R, c.G, c.B); Set("titleBarColor", Css(bar, bar.A / 255.0)); })),
                Row("Title bar strength", SliderRow(string.IsNullOrEmpty(Theme.Str(style["titleBarColor"])) ? 0 : Math.Round(bar.A / 255.0 * 100), 0, 100, 5, v =>
                {
                    bar = Color.FromArgb((byte)Math.Round(v / 100 * 255), bar.R, bar.G, bar.B);
                    Set("titleBarColor", v <= 0 ? null : JsonValue.Create(Css(bar, bar.A / 255.0)));
                }, "%")),
                Row("Open tab colour", Swatches(AccentColors, tab, c => { tab = Color.FromArgb(Math.Max(tab.A, (byte)70), c.R, c.G, c.B); Set("tabColor", Css(tab, tab.A / 255.0)); })),
                Row("Folder icon before the title", Switch(style["compactHeader"] is JsonValue cv && cv.TryGetValue(out bool cb) && cb, on => Set("compactHeader", on)))));
            stack.Children.Add(Section("Icons",
                Row("Icon size", SliderRow(NumOf("iconPx", 34), 16, 96, 2, v => Set("iconPx", v), " px")),
                Row("Name size", SliderRow(NumOf("itemLabelSize", 10), 8, 18, 1, v => Set("itemLabelSize", v), " px")),
                Row("Columns", Choice(new[] { ("0", "As many as fit"), ("1", "1"), ("2", "2"), ("3", "3"), ("4", "4"), ("5", "5"), ("6", "6"), ("8", "8") },
                    ((int)NumOf("columns", 0)).ToString(CultureInfo.InvariantCulture), v => Set("columns", v == "0" || v == null ? null : JsonValue.Create(int.Parse(v, CultureInfo.InvariantCulture))))),
                Row("Icon tint", Swatches(AccentColors.Skip(1), tint, c => { Set("iconTint", Hex(c)); if (NumOf("iconTintStrength", 0) <= 0) { Set("iconTintStrength", 0.6); Rebuild(); } }), "Lays a colour over every icon, keeping its light and shade"),
                Row("Tint strength", SliderRow(Math.Round(NumOf("iconTintStrength", 0) * 100), 0, 100, 5, v => Set("iconTintStrength", v / 100), "%"))));
            stack.Children.Add(Section("Size",
                Row("Width", SliderRow(fence.Data.Width, 160, 1400, 10, v => PreviewSize(v, null), " px")),
                Row("Height", SliderRow(fence.Data.Height, 60, 1200, 10, v => PreviewSize(null, v), " px"))));
            stack.Children.Add(Section("Name", Row("Fence name", Field(fence.Data.Name, v => { if (!string.IsNullOrWhiteSpace(v)) fence.Data.Raw["name"] = v.Trim(); fence.Refresh(); }))));
            stack.Children.Add(Buttons(
                Btn("Apply look to all fences", ApplyToAll),
                Btn("Cancel", Cancel),
                Btn("Save", Save, primary: true)));
            Body.Content = stack;
        }

        void Rebuild() => Build(); // re-reads the style so chips / sliders show the new values

        void PreviewSize(double? width, double? height)
        {
            var size = fence.Data.Raw["size"] as JsonObject ?? new JsonObject();
            if (width.HasValue) size["width"] = Math.Round(width.Value);
            if (height.HasValue) size["height"] = Math.Round(height.Value);
            fence.Data.Raw["size"] = JsonNode.Parse(size.ToJsonString());
            fence.Place();
        }

        void ApplyToAll()
        {
            var count = app.FenceCount;
            if (MessageBox.Show(this, $"Give all {count} fences this look (colours, corners, title bar, icons)?\n\nNames, sizes and contents stay as they are.", "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;
            app.ApplyStyleToAll(style);
            Save();
        }

        void Save()
        {
            saved = true;
            fence.Data.Raw["style"] = JsonNode.Parse(style.ToJsonString());
            fence.Data.Touch();
            app.SaveSoon();
            fence.Refresh();
            Close();
        }

        void Cancel()
        {
            Close(); // OnClosed restores
        }

        protected override void OnCloseRequested() => Cancel();

        protected override void OnClosed(EventArgs e)
        {
            if (!saved)
            {
                fence.Data.Raw["style"] = JsonNode.Parse(originalStyle);
                fence.Data.Raw["size"] = JsonNode.Parse(originalSize);
                fence.Data.Raw["name"] = originalName;
                fence.Refresh();
                fence.Place();
            }
            base.OnClosed(e);
        }
    }
}
