using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Win32;

namespace DeskFence
{
    /// <summary>
    /// A Windows 11 style dialog window: Mica backdrop (Windows 11 22H2+, a solid panel before),
    /// rounded corners, dark / light like the system, its own title bar with a close button.
    /// </summary>
    internal class FluentWindow : Window
    {
        public static readonly bool Dark = IsDarkMode();
        protected readonly ContentControl Body = new ContentControl();
        readonly TextBlock caption = new TextBlock();

        public static Brush Fg => Dark ? Brushes.White : new SolidColorBrush(Color.FromRgb(26, 26, 26));
        public static Brush Subtle => new SolidColorBrush(Dark ? Color.FromArgb(160, 255, 255, 255) : Color.FromArgb(150, 0, 0, 0));
        public static Brush Card => new SolidColorBrush(Dark ? Color.FromArgb(22, 255, 255, 255) : Color.FromArgb(180, 255, 255, 255));
        public static Brush CardBorder => new SolidColorBrush(Dark ? Color.FromArgb(25, 255, 255, 255) : Color.FromArgb(25, 0, 0, 0));
        public static Brush Accent => new SolidColorBrush(Dark ? Color.FromRgb(96, 205, 255) : Color.FromRgb(0, 95, 184));
        public static Brush AccentText => Dark ? Brushes.Black : Brushes.White;

        public FluentWindow(string title, double width)
        {
            Title = title;
            Width = width;
            SizeToContent = SizeToContent.Height;
            MaxHeight = SystemParameters.WorkArea.Height - 40;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ShowInTaskbar = false;
            Topmost = true;
            Background = Brushes.Transparent;
            FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI");
            FontSize = 13;
            Foreground = Fg;
            UseLayoutRounding = true;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
            WindowChrome.SetWindowChrome(this, new WindowChrome
            {
                GlassFrameThickness = new Thickness(-1),
                CaptionHeight = 40,
                ResizeBorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(0),
                UseAeroCaptionButtons = false,
            });

            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(40) });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            caption.Text = title;
            caption.Margin = new Thickness(16, 0, 0, 0);
            caption.VerticalAlignment = VerticalAlignment.Center;
            caption.FontSize = 13;
            grid.Children.Add(caption);
            var close = new Button
            {
                Content = new TextBlock { Text = "", FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets"), FontSize = 10, Foreground = Fg },
                Width = 46,
                Height = 32,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Template = PlainButton(Color.FromRgb(196, 43, 28)),
                ToolTip = "Close",
            };
            WindowChrome.SetIsHitTestVisibleInChrome(close, true);
            close.Click += (_, __) => OnCloseRequested();
            grid.Children.Add(close);

            var scroll = new ScrollViewer { Content = Body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(16, 0, 16, 16) };
            Grid.SetRow(scroll, 1);
            grid.Children.Add(scroll);

            Content = new Border
            {
                Child = grid,
                Background = new SolidColorBrush(BackdropWorks
                    ? (Dark ? Color.FromArgb(90, 32, 32, 32) : Color.FromArgb(90, 243, 243, 243))
                    : (Dark ? Color.FromRgb(32, 32, 32) : Color.FromRgb(243, 243, 243))),
                BorderBrush = CardBorder,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
            };
            KeyDown += (_, e) => { if (e.Key == Key.Escape) OnCloseRequested(); };
        }

        /// <summary>The ✕ button and Esc; a dialog with unsaved preview changes overrides this.</summary>
        protected virtual void OnCloseRequested() => Close();

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            IntPtr hwnd = new WindowInteropHelper(this).Handle;
            HwndSource.FromHwnd(hwnd).CompositionTarget.BackgroundColor = Colors.Transparent;
            int on = Dark ? 1 : 0;
            DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int)); // dark title / frame
            int round = 2;
            DwmSetWindowAttribute(hwnd, 33, ref round, sizeof(int)); // rounded corners
            if (BackdropWorks)
            {
                int mica = 2;
                DwmSetWindowAttribute(hwnd, 38, ref mica, sizeof(int)); // Mica
            }
        }

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
        static bool BackdropWorks => Environment.OSVersion.Version.Build >= 22621;

        static bool IsDarkMode()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
                return !(key?.GetValue("AppsUseLightTheme") is int light && light == 1);
            }
            catch
            {
                return true;
            }
        }

        // ================= small building blocks (Fluent-looking, no old grey controls) =================
        public static ControlTemplate PlainButton(Color hover)
        {
            var template = new ControlTemplate(typeof(Button));
            var border = new FrameworkElementFactory(typeof(Border), "bd");
            border.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(4));
            border.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(content);
            template.VisualTree = border;
            var trigger = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
            trigger.Setters.Add(new Setter(Border.BackgroundProperty, new SolidColorBrush(hover), "bd"));
            template.Triggers.Add(trigger);
            var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
            disabled.Setters.Add(new Setter(UIElement.OpacityProperty, 0.4));
            template.Triggers.Add(disabled);
            return template;
        }

        public static Button Btn(string text, Action click, bool primary = false)
        {
            var b = new Button
            {
                Content = text,
                Padding = new Thickness(14, 6, 14, 6),
                Margin = new Thickness(4, 0, 0, 0),
                MinWidth = 80,
                Foreground = primary ? AccentText : Fg,
                Background = primary ? Accent : new SolidColorBrush(Dark ? Color.FromArgb(18, 255, 255, 255) : Color.FromArgb(200, 255, 255, 255)),
                BorderThickness = new Thickness(0),
                Cursor = Cursors.Hand,
                Template = PlainButton(primary ? (Dark ? Color.FromRgb(80, 180, 230) : Color.FromRgb(0, 84, 165)) : (Dark ? Color.FromArgb(35, 255, 255, 255) : Color.FromArgb(255, 245, 245, 245))),
            };
            b.Click += (_, __) => click();
            return b;
        }

        public static Border Chip(string text, bool active, Action click, Brush background = null, Brush foreground = null)
        {
            var chip = new Border
            {
                Child = new TextBlock { Text = text, Foreground = foreground ?? Fg, FontSize = 12 },
                Padding = new Thickness(10, 4, 10, 4),
                Margin = new Thickness(0, 0, 6, 6),
                CornerRadius = new CornerRadius(4),
                Background = background ?? new SolidColorBrush(Dark ? Color.FromArgb(18, 255, 255, 255) : Color.FromArgb(200, 255, 255, 255)),
                BorderBrush = active ? Accent : CardBorder,
                BorderThickness = new Thickness(active ? 2 : 1),
                Cursor = Cursors.Hand,
            };
            chip.MouseLeftButtonUp += (_, __) => click();
            return chip;
        }

        /// <summary>A titled group of settings rows on a card.</summary>
        public static UIElement Section(string title, params UIElement[] rows)
        {
            var panel = new StackPanel { Margin = new Thickness(0, 10, 0, 0) };
            panel.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.SemiBold, Margin = new Thickness(2, 0, 0, 6), Foreground = Fg });
            var card = new StackPanel();
            foreach (var r in rows) if (r != null) card.Children.Add(r);
            panel.Children.Add(new Border { Child = card, Background = Card, BorderBrush = CardBorder, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(12, 6, 12, 6) });
            return panel;
        }

        public static UIElement Row(string label, UIElement control, string hint = null)
        {
            var grid = new Grid { MinHeight = 36 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var text = new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center, Foreground = Fg, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 12, 4), ToolTip = hint };
            grid.Children.Add(text);
            if (control is FrameworkElement fe) fe.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(control, 1);
            grid.Children.Add(control);
            return grid;
        }

        public static UIElement SliderRow(double value, double min, double max, double step, Action<double> changed, string unit = "")
        {
            var slider = new Slider { Minimum = min, Maximum = max, Value = Math.Clamp(value, min, max), Width = 150, TickFrequency = step, IsSnapToTickEnabled = true, VerticalAlignment = VerticalAlignment.Center };
            var shown = new TextBlock { Width = 46, TextAlignment = TextAlignment.Right, Foreground = Subtle, VerticalAlignment = VerticalAlignment.Center, Text = Math.Round(slider.Value, 1) + unit };
            slider.ValueChanged += (_, e) =>
            {
                shown.Text = Math.Round(e.NewValue, 1) + unit;
                changed(e.NewValue);
            };
            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(slider);
            panel.Children.Add(shown);
            return panel;
        }

        /// <summary>A Windows 11 style on/off switch.</summary>
        public static UIElement Switch(bool on, Action<bool> changed)
        {
            var knob = new Border { Width = 12, Height = 12, CornerRadius = new CornerRadius(6), Margin = new Thickness(3, 0, 3, 0) };
            var track = new Border { Width = 40, Height = 20, CornerRadius = new CornerRadius(10), BorderThickness = new Thickness(1), Child = knob, Cursor = Cursors.Hand };
            void Paint()
            {
                track.Background = on ? Accent : Brushes.Transparent;
                track.BorderBrush = on ? Accent : Subtle;
                knob.Background = on ? AccentText : Subtle;
                knob.HorizontalAlignment = on ? HorizontalAlignment.Right : HorizontalAlignment.Left;
            }
            Paint();
            track.MouseLeftButtonUp += (_, __) =>
            {
                on = !on;
                Paint();
                changed(on);
            };
            return track;
        }

        /// <summary>Colour swatches plus a "more colours" picker.</summary>
        public static UIElement Swatches(IEnumerable<Color> colors, Color current, Action<Color> picked)
        {
            var panel = new WrapPanel { MaxWidth = 260, HorizontalAlignment = HorizontalAlignment.Right };
            var all = new List<Border>();
            void Mark(Color c)
            {
                foreach (var b in all) b.BorderBrush = b.Tag is Color t && t.R == c.R && t.G == c.G && t.B == c.B ? Accent : CardBorder;
            }
            foreach (var color in colors)
            {
                var c = color;
                var swatch = new Border { Width = 22, Height = 22, CornerRadius = new CornerRadius(11), Margin = new Thickness(3), Background = new SolidColorBrush(Color.FromRgb(c.R, c.G, c.B)), BorderThickness = new Thickness(2), Cursor = Cursors.Hand, Tag = c };
                swatch.MouseLeftButtonUp += (_, __) => { Mark(c); picked(c); };
                all.Add(swatch);
                panel.Children.Add(swatch);
            }
            var more = new Border { Width = 22, Height = 22, CornerRadius = new CornerRadius(11), Margin = new Thickness(3), BorderThickness = new Thickness(1), BorderBrush = Subtle, Cursor = Cursors.Hand, ToolTip = "More colours…", Child = new TextBlock { Text = "", FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets"), FontSize = 10, Foreground = Fg, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } };
            more.MouseLeftButtonUp += (_, __) =>
            {
                using var dialog = new System.Windows.Forms.ColorDialog { FullOpen = true, Color = System.Drawing.Color.FromArgb(current.R, current.G, current.B) };
                if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    var c = Color.FromRgb(dialog.Color.R, dialog.Color.G, dialog.Color.B);
                    current = c;
                    Mark(c);
                    picked(c);
                }
            };
            panel.Children.Add(more);
            Mark(current);
            return panel;
        }

        public static TextBox Field(string text, Action<string> changed, double width = 220)
        {
            var box = new TextBox
            {
                Text = text ?? "",
                Width = width,
                Padding = new Thickness(6, 4, 6, 4),
                Foreground = Fg,
                CaretBrush = Fg,
                Background = new SolidColorBrush(Dark ? Color.FromArgb(18, 255, 255, 255) : Color.FromArgb(220, 255, 255, 255)),
                BorderBrush = CardBorder,
                BorderThickness = new Thickness(1, 1, 1, 2),
            };
            box.TextChanged += (_, __) => changed?.Invoke(box.Text);
            return box;
        }

        public static ComboBox Choice(IEnumerable<(string Value, string Label)> options, string current, Action<string> changed, double width = 160)
        {
            var combo = new ComboBox { Width = width };
            foreach (var (value, label) in options)
            {
                var item = new ComboBoxItem { Content = label, Tag = value };
                combo.Items.Add(item);
                if (value == current) combo.SelectedItem = item;
            }
            if (combo.SelectedItem == null && combo.Items.Count > 0) combo.SelectedIndex = 0;
            combo.SelectionChanged += (_, __) => changed((combo.SelectedItem as ComboBoxItem)?.Tag as string);
            return combo;
        }

        public static StackPanel Buttons(params UIElement[] buttons)
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
            foreach (var b in buttons) panel.Children.Add(b);
            return panel;
        }
    }
}
