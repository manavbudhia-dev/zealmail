using System;
using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace DeskFence
{
    /// <summary>One icon in a fence: real Windows icon, name under it, Explorer-like mouse handling.</summary>
    internal sealed class ItemTile : Border
    {
        readonly DeskFenceApp app;
        readonly FenceWindow fence;
        readonly JsonObject item;
        readonly Image image = new Image();
        readonly TextBlock emoji = new TextBlock();
        Point pressPoint;
        bool pressed;
        bool selected;

        public string ItemId => Theme.Str(item["id"]);
        string ItemPath => Theme.Str(item["path"]) ?? "";
        string ItemName => Theme.Str(item["name"]) ?? Path.GetFileName(ItemPath);

        public bool IsSelected
        {
            get => selected;
            set
            {
                selected = value;
                Background = value ? new SolidColorBrush(Color.FromArgb(60, 255, 255, 255)) : Brushes.Transparent;
            }
        }

        public ItemTile(DeskFenceApp app, FenceWindow fence, JsonObject item, Theme.Look look, double cell)
        {
            this.app = app;
            this.fence = fence;
            this.item = item;
            Width = cell;
            Margin = new Thickness(0, 2, 0, 2);
            Padding = new Thickness(1, 4, 1, 3);
            CornerRadius = new CornerRadius(4);
            Background = Brushes.Transparent;
            ToolTip = ItemPath;
            Cursor = Cursors.Arrow;

            var stack = new StackPanel();
            int px = (int)look.IconPx;
            var iconBox = new Grid { Width = px, Height = px, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 3) };
            image.Width = px;
            image.Height = px;
            RenderOptions.SetBitmapScalingMode(image, BitmapScalingMode.HighQuality);
            emoji.Text = Theme.Str(item["type"]) == "folder" ? "📁" : "📄";
            emoji.FontSize = px * 0.8;
            emoji.HorizontalAlignment = HorizontalAlignment.Center;
            emoji.VerticalAlignment = VerticalAlignment.Center;
            iconBox.Children.Add(emoji);
            iconBox.Children.Add(image);
            if (look.TintStrength > 0)
            {
                // icon tint: the colour laid over the icon's own shape, keeping its light and shade
                iconBox.Children.Add(new Border
                {
                    Background = new SolidColorBrush(look.Tint),
                    Opacity = look.TintStrength * 0.7,
                    OpacityMask = new VisualBrush(image) { Stretch = Stretch.Uniform },
                    IsHitTestVisible = false,
                });
            }
            stack.Children.Add(iconBox);

            // name under the icon, with a soft dark copy behind it so it reads on any background
            string name = DisplayName(ItemName);
            var label = new Grid { HorizontalAlignment = HorizontalAlignment.Center };
            label.Children.Add(Label(name, Color.FromArgb(170, 0, 0, 0), look.ItemLabelSize, new Thickness(1, 1, 0, 0)));
            label.Children.Add(Label(name, look.Label, look.ItemLabelSize, new Thickness(0)));
            stack.Children.Add(label);
            Child = stack;

            LoadIcon(px);

            MouseEnter += (_, __) => { if (!selected) Background = new SolidColorBrush(Color.FromArgb(28, 255, 255, 255)); };
            MouseLeave += (_, __) => { if (!selected) Background = Brushes.Transparent; };
            MouseLeftButtonDown += OnLeftDown;
            MouseMove += OnMove;
            MouseLeftButtonUp += (_, __) => pressed = false;
            MouseRightButtonUp += (_, e) =>
            {
                fence.Select(ItemId);
                ShowMenu();
                e.Handled = true;
            };
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

        /// <summary>Windows never shows the .lnk / .url of a shortcut.</summary>
        public static string DisplayName(string name)
        {
            if (name.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".url", StringComparison.OrdinalIgnoreCase))
                return name.Substring(0, name.Length - 4);
            return name;
        }

        void LoadIcon(int px)
        {
            string icon = Theme.Str(item["icon"]);
            if (!string.IsNullOrEmpty(icon) && icon.StartsWith("data:", StringComparison.Ordinal))
            {
                var stored = ShellIcons.FromDataUrl(icon);
                if (stored != null) { SetIcon(stored); return; }
            }
            int size = px <= 32 ? 32 : px <= 48 ? 48 : px <= 64 ? 64 : px <= 96 ? 96 : 128;
            ShellIcons.Request(ItemPath, size, SetIcon);
        }

        void SetIcon(ImageSource source)
        {
            image.Source = source;
            emoji.Visibility = source == null ? Visibility.Visible : Visibility.Collapsed;
        }

        void OnLeftDown(object sender, MouseButtonEventArgs e)
        {
            fence.Select(ItemId);
            if (e.ClickCount == 2)
            {
                pressed = false;
                app.OpenItem(fence, item);
                e.Handled = true;
                return;
            }
            pressPoint = e.GetPosition(this);
            pressed = true;
            e.Handled = true; // a press on an icon does not drag the fence
        }

        // Drag the real file out: Windows itself handles the drop (Desktop, Explorer, another fence...)
        void OnMove(object sender, MouseEventArgs e)
        {
            if (!pressed || e.LeftButton != MouseButtonState.Pressed) return;
            var now = e.GetPosition(this);
            if (Math.Abs(now.X - pressPoint.X) < SystemParameters.MinimumHorizontalDragDistance &&
                Math.Abs(now.Y - pressPoint.Y) < SystemParameters.MinimumVerticalDragDistance) return;
            pressed = false;
            if (fence.Data.IsLocked) return;
            string path = ItemPath;
            if (!File.Exists(path) && !Directory.Exists(path)) return;

            var data = new DataObject(DataFormats.FileDrop, new[] { path });
            var allowed = app.OwnsFile(fence.Data, path)
                ? DragDropEffects.Move | DragDropEffects.Copy | DragDropEffects.Link
                : DragDropEffects.Copy | DragDropEffects.Link; // a shortcut-only item: never move the user's own file
            try
            {
                DragDrop.DoDragDrop(this, data, allowed);
            }
            catch (Exception error)
            {
                Log.Error("Drag out", error);
            }
            app.AfterDragOut(fence); // the file may have moved: the fence's folder watcher catches up
        }

        void ShowMenu()
        {
            var menu = new ContextMenu { PlacementTarget = this };
            void Add(string text, Action action, bool enabled = true)
            {
                var mi = new MenuItem { Header = text, IsEnabled = enabled };
                mi.Click += (_, __) => action();
                menu.Items.Add(mi);
            }
            bool exists = File.Exists(ItemPath) || Directory.Exists(ItemPath);
            bool owns = app.OwnsFile(fence.Data, ItemPath);
            bool locked = fence.Data.IsLocked;

            Add("Open", () => app.OpenItem(fence, item), exists);
            Add("Open file location", () => app.ShowInFolder(ItemPath), exists);
            Add("Copy path", () => { try { Clipboard.SetText(ItemPath); } catch { /* clipboard busy */ } });
            menu.Items.Add(new Separator());
            if (owns && string.IsNullOrEmpty(fence.Data.PortalPath))
                Add("Move back to the Desktop", () => app.MoveItemToDesktop(fence, item), !locked && exists);
            // a file the fence owns stays shown while it is in the fence folder: move or delete it instead
            if (!owns && string.IsNullOrEmpty(fence.Data.PortalPath))
                Add("Remove from fence", () => app.RemoveItem(fence, item), !locked);
            if (owns || !string.IsNullOrEmpty(fence.Data.PortalPath))
                Add("Delete (Recycle Bin)", () => app.DeleteItemFile(fence, item), !locked && exists);
            menu.IsOpen = true;
        }
    }
}
