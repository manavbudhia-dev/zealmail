using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace DeskFence
{
    /// <summary>
    /// What an icon tile and a Details row share: the item, its real Windows icon, Explorer-like mouse
    /// handling (click selects, double-click opens), the right-click menu and dragging the file out.
    /// </summary>
    internal abstract class ItemBase : Border
    {
        protected readonly DeskFenceApp App;
        protected readonly FenceWindow Fence;
        protected readonly JsonObject Item;
        /// <summary>An item of a sub-folder being browsed: not stored in the fence (no move / remove).</summary>
        protected readonly bool ReadOnly;
        protected readonly Image IconImage = new Image();
        protected readonly TextBlock Fallback = new TextBlock();
        Point pressPoint;
        bool pressed;
        bool selected;

        public string ItemId => Theme.Str(Item["id"]);
        protected string ItemPath => Theme.Str(Item["path"]) ?? "";
        protected string ItemName => Theme.Str(Item["name"]) ?? Path.GetFileName(ItemPath.TrimEnd('\\', '/'));
        protected bool IsFolder => Theme.Str(Item["type"]) == "folder" || Directory.Exists(ItemPath);

        protected ItemBase(DeskFenceApp app, FenceWindow fence, JsonObject item, bool readOnly)
        {
            App = app;
            Fence = fence;
            Item = item;
            ReadOnly = readOnly;
            Background = Brushes.Transparent;
            CornerRadius = new CornerRadius(4);
            ToolTip = ItemPath;
            RenderOptions.SetBitmapScalingMode(IconImage, BitmapScalingMode.Fant); // best quality when shrinking
            IconImage.SnapsToDevicePixels = true;
            IconImage.UseLayoutRounding = true;
            Fallback.Text = Theme.Str(item["type"]) == "folder" ? "📁" : "📄";
            Fallback.HorizontalAlignment = HorizontalAlignment.Center;
            Fallback.VerticalAlignment = VerticalAlignment.Center;

            MouseEnter += (_, __) => { if (!selected) Background = new SolidColorBrush(Color.FromArgb(28, 255, 255, 255)); };
            MouseLeave += (_, __) => { if (!selected) Background = Brushes.Transparent; };
            MouseLeftButtonDown += OnLeftDown;
            MouseMove += OnMove;
            MouseLeftButtonUp += (_, __) => pressed = false;
            MouseRightButtonUp += (_, e) =>
            {
                Fence.Select(ItemId);
                ShowMenu();
                e.Handled = true;
            };
        }

        public bool IsSelected
        {
            get => selected;
            set
            {
                selected = value;
                Background = value ? new SolidColorBrush(Color.FromArgb(60, 255, 255, 255)) : Brushes.Transparent;
            }
        }

        /// <summary>Windows never shows the .lnk / .url of a shortcut.</summary>
        public static string DisplayName(string name)
        {
            if (name.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".url", StringComparison.OrdinalIgnoreCase))
                return name.Substring(0, name.Length - 4);
            return name;
        }

        protected void LoadIcon(int px)
        {
            string icon = Theme.Str(Item["icon"]);
            if (!string.IsNullOrEmpty(icon) && icon.StartsWith("data:", StringComparison.Ordinal))
            {
                var stored = ShellIcons.FromDataUrl(icon);
                if (stored != null) { SetIcon(stored); return; }
            }
            // ask Windows for the icon at the REAL pixel size on this monitor (125% / 150% scaling makes a
            // 34-px icon 43-51 real pixels): a smaller picture stretched up looks soft
            double scale = 1;
            try { scale = Math.Max(1, Screens.ByDevice(Fence.Data.ScreenDevice)?.Scale ?? 1); } catch { /* 100% */ }
            double real = px * scale;
            int size = real <= 16 ? 16 : real <= 24 ? 24 : real <= 32 ? 32 : real <= 48 ? 48 : real <= 64 ? 64 : real <= 96 ? 96 : real <= 128 ? 128 : 256;
            ShellIcons.Request(ItemPath, size, SetIcon);
        }

        void SetIcon(ImageSource source)
        {
            IconImage.Source = source;
            Fallback.Visibility = source == null ? Visibility.Visible : Visibility.Collapsed;
        }

        /// <summary>The icon (with the fence's tint laid over its shape, keeping light and shade).</summary>
        protected Grid IconBox(int px, Theme.Look look)
        {
            var box = new Grid { Width = px, Height = px };
            IconImage.Width = px;
            IconImage.Height = px;
            Fallback.FontSize = px * 0.8;
            box.Children.Add(Fallback);
            box.Children.Add(IconImage);
            if (look.TintStrength > 0)
            {
                box.Children.Add(new Border
                {
                    Background = new SolidColorBrush(look.Tint),
                    Opacity = look.TintStrength * 0.7,
                    OpacityMask = new VisualBrush(IconImage) { Stretch = Stretch.Uniform },
                    IsHitTestVisible = false,
                });
            }
            LoadIcon(px);
            return box;
        }

        void OnLeftDown(object sender, MouseButtonEventArgs e)
        {
            Fence.Select(ItemId);
            if (e.ClickCount == 2)
            {
                pressed = false;
                // in a fence that shows a folder, a sub-folder opens inside the fence
                if (IsFolder && !string.IsNullOrEmpty(Fence.Data.PortalPath)) Fence.Browse(ItemPath);
                else App.OpenItem(Fence, Item);
                e.Handled = true;
                return;
            }
            pressPoint = e.GetPosition(this);
            pressed = true;
            e.Handled = true; // a press on an item does not drag the fence
        }

        // Drag the real file out: Windows itself handles the drop (Desktop, Explorer, another fence...)
        void OnMove(object sender, MouseEventArgs e)
        {
            if (!pressed || e.LeftButton != MouseButtonState.Pressed) return;
            var now = e.GetPosition(this);
            if (Math.Abs(now.X - pressPoint.X) < SystemParameters.MinimumHorizontalDragDistance &&
                Math.Abs(now.Y - pressPoint.Y) < SystemParameters.MinimumVerticalDragDistance) return;
            pressed = false;
            if (Fence.Data.IsLocked) return;
            string path = ItemPath;
            if (!File.Exists(path) && !Directory.Exists(path)) return;

            var data = new DataObject(DataFormats.FileDrop, new[] { path });
            bool owns = App.OwnsFile(Fence.Data, path) || ReadOnly; // a browsed sub-folder item is a real file too
            var allowed = owns
                ? DragDropEffects.Move | DragDropEffects.Copy | DragDropEffects.Link
                : DragDropEffects.Copy | DragDropEffects.Link; // a shortcut-only item: never move the user's own file
            App.NoteLeaving(path);
            try
            {
                DragDrop.DoDragDrop(this, data, allowed);
            }
            catch (Exception error)
            {
                Log.Error("Drag out", error);
            }
            App.AfterDragOut(Fence);
        }

        void ShowMenu()
        {
            bool exists = File.Exists(ItemPath) || Directory.Exists(ItemPath);
            bool owns = App.OwnsFile(Fence.Data, ItemPath);
            bool portal = !string.IsNullOrEmpty(Fence.Data.PortalPath);
            bool locked = Fence.Data.IsLocked;
            var entries = new List<MenuEntry>
            {
                MenuEntry.Item(Glyphs.Open, "Open", () => App.OpenItem(Fence, Item), exists),
            };
            if (portal && IsFolder) entries.Add(MenuEntry.Item(Glyphs.Folder, "Open in this fence", () => Fence.Browse(ItemPath), exists));
            entries.Add(MenuEntry.Item(Glyphs.Folder, "Open file location", () => App.ShowInFolder(ItemPath), exists));
            entries.Add(MenuEntry.Item(Glyphs.Copy, "Copy path", () => { try { Clipboard.SetText(ItemPath); } catch { /* clipboard busy */ } }));
            entries.Add(MenuEntry.Separator());
            if (!ReadOnly)
            {
                if (owns && !portal)
                    entries.Add(MenuEntry.Item(Glyphs.Desktop, "Move back to the Desktop", () => App.MoveItemToDesktop(Fence, Item), !locked && exists));
                // a file the fence owns stays shown while it is in the fence folder: move or delete it instead
                if (!owns && !portal)
                    entries.Add(MenuEntry.Item(Glyphs.Remove, "Remove from fence", () => App.RemoveItem(Fence, Item), !locked));
            }
            if (owns || portal || ReadOnly)
                entries.Add(MenuEntry.Item(Glyphs.Delete, "Delete", () => App.DeleteItemFile(Fence, Item), !locked && exists));
            FluentMenu.ShowAtCursor(entries);
        }
    }

    /// <summary>One icon in a fence: icon with its name under it.</summary>
    internal sealed class ItemTile : ItemBase
    {
        public ItemTile(DeskFenceApp app, FenceWindow fence, JsonObject item, Theme.Look look, double cell, bool readOnly = false)
            : base(app, fence, item, readOnly)
        {
            Width = cell;
            Margin = new Thickness(0, 2, 0, 2);
            Padding = new Thickness(1, 4, 1, 3);
            var stack = new StackPanel();
            var icon = IconBox((int)look.IconPx, look);
            icon.HorizontalAlignment = HorizontalAlignment.Center;
            icon.Margin = new Thickness(0, 0, 0, 3);
            stack.Children.Add(icon);
            // the name, with a soft dark copy behind it so it reads on any background
            string name = DisplayName(ItemName);
            var label = new Grid { HorizontalAlignment = HorizontalAlignment.Center };
            label.Children.Add(Label(name, Color.FromArgb(170, 0, 0, 0), look.ItemLabelSize, new Thickness(1, 1, 0, 0)));
            label.Children.Add(Label(name, look.Label, look.ItemLabelSize, new Thickness(0)));
            stack.Children.Add(label);
            Child = stack;
        }

        static TextBlock Label(string text, Color color, double size, Thickness margin) => new TextBlock
        {
            Text = text,
            Foreground = new SolidColorBrush(color),
            FontSize = size + 1,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxHeight = (size + 1) * 2.7, // two lines
            Margin = margin,
        };
    }

    /// <summary>One line of the Details view: Name (small icon), Date modified, Type, Size.</summary>
    internal sealed class ItemRow : ItemBase
    {
        public static readonly string[] AllColumns = { "name", "modified", "type", "size" };

        /// <summary>Columns that fit a fence of this width (Name always).</summary>
        public static string[] ColumnsFor(double width) =>
            width < 380 ? new[] { "name", "size" } : width < 560 ? new[] { "name", "modified", "size" } : AllColumns;

        public static GridLength WidthOf(string column) => column switch
        {
            "name" => new GridLength(2.4, GridUnitType.Star),
            "modified" => new GridLength(1.5, GridUnitType.Star),
            "type" => new GridLength(1.1, GridUnitType.Star),
            _ => new GridLength(0.8, GridUnitType.Star),
        };

        public ItemRow(DeskFenceApp app, FenceWindow fence, JsonObject item, Theme.Look look, string[] columns, bool readOnly = false)
            : base(app, fence, item, readOnly)
        {
            Padding = new Thickness(6, 0, 6, 0);
            Margin = new Thickness(0, 0, 0, 1);
            double fontSize = Math.Max(11, look.ItemLabelSize + 2);
            var grid = new Grid { MinHeight = Math.Round(fontSize * 1.9) };
            var info = FileInfoOf(ItemPath);
            var brush = new SolidColorBrush(look.Label);
            for (int i = 0; i < columns.Length; i++)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = WidthOf(columns[i]) });
                UIElement cell;
                if (columns[i] == "name")
                {
                    var panel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                    var icon = IconBox(16, look);
                    icon.Margin = new Thickness(0, 0, 6, 0);
                    panel.Children.Add(icon);
                    panel.Children.Add(new TextBlock { Text = DisplayName(ItemName), Foreground = brush, FontSize = fontSize, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center });
                    cell = panel;
                }
                else
                {
                    string text = columns[i] switch
                    {
                        "modified" => info == null ? "" : info.LastWriteTime.ToString("g", CultureInfo.CurrentCulture),
                        "type" => TypeLabel(ItemName, IsFolder),
                        _ => info is FileInfo f ? FormatSize(f.Length) : "",
                    };
                    cell = new TextBlock
                    {
                        Text = text,
                        Foreground = brush,
                        Opacity = 0.8,
                        FontSize = fontSize,
                        TextTrimming = TextTrimming.CharacterEllipsis,
                        VerticalAlignment = VerticalAlignment.Center,
                        TextAlignment = columns[i] == "size" ? TextAlignment.Right : TextAlignment.Left,
                        Margin = new Thickness(8, 0, 0, 0),
                    };
                }
                Grid.SetColumn(cell, i);
                grid.Children.Add(cell);
            }
            Child = grid;
        }

        public static FileSystemInfo FileInfoOf(string path)
        {
            try
            {
                if (Directory.Exists(path)) return new DirectoryInfo(path);
                if (File.Exists(path)) return new FileInfo(path);
            }
            catch
            {
                /* no access */
            }
            return null;
        }

        /// <summary>Explorer-style size: "812 bytes", "38.4 MB", "1.27 GB".</summary>
        public static string FormatSize(long bytes)
        {
            if (bytes < 1024) return bytes + " bytes";
            string[] units = { "KB", "MB", "GB", "TB" };
            double value = bytes / 1024.0;
            int unit = 0;
            while (value >= 1000 && unit < units.Length - 1) { value /= 1024; unit++; }
            string text = value >= 100 ? Math.Round(value).ToString(CultureInfo.CurrentCulture) : value >= 10 ? value.ToString("0.#", CultureInfo.CurrentCulture) : value.ToString("0.##", CultureInfo.CurrentCulture);
            return text + " " + units[unit];
        }

        static readonly Dictionary<string, string> KnownTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["exe"] = "Application", ["msi"] = "Windows Installer Package", ["lnk"] = "Shortcut", ["url"] = "Internet Shortcut",
            ["txt"] = "Text Document", ["pdf"] = "PDF Document", ["zip"] = "Compressed (zipped) Folder", ["jpg"] = "JPG File",
            ["jpeg"] = "JPEG File", ["png"] = "PNG File", ["docx"] = "Microsoft Word Document", ["xlsx"] = "Microsoft Excel Worksheet",
            ["pptx"] = "Microsoft PowerPoint Presentation", ["mp3"] = "MP3 File", ["mp4"] = "MP4 File",
        };

        /// <summary>Explorer-style type: "File folder", "Application", "PNG File"...</summary>
        public static string TypeLabel(string name, bool isFolder)
        {
            if (isFolder) return "File folder";
            int dot = name.LastIndexOf('.');
            string ext = dot > 0 ? name.Substring(dot + 1) : "";
            if (ext.Length == 0) return "File";
            return KnownTypes.TryGetValue(ext, out var known) ? known : ext.ToUpperInvariant() + " File";
        }
    }
}
