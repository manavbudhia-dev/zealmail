using System;
using System.Drawing;
using WF = System.Windows.Forms;

namespace DeskFence
{
    /// <summary>The notification-area icon and its menu: the always-reachable way into DeskFence.</summary>
    internal sealed class Tray : IDisposable
    {
        readonly DeskFenceApp app;
        readonly WF.NotifyIcon icon;
        readonly WF.ToolStripMenuItem showHide, quickHide, quickHideIcons, winSpace, draw, autoStart;

        public Tray(DeskFenceApp app)
        {
            this.app = app;
            var menu = new WF.ContextMenuStrip();
            menu.Items.Add("New fence (drag a rectangle)", null, (_, __) => app.StartDrawMode());
            showHide = new WF.ToolStripMenuItem("Hide all fences", null, (_, __) => app.ToggleQuickHide());
            menu.Items.Add(showHide);
            menu.Items.Add("Peek: fences above windows (Win+Space)", null, (_, __) => app.SetPeek(true));
            menu.Items.Add(new WF.ToolStripSeparator());

            var settingsMenu = new WF.ToolStripMenuItem("Settings");
            draw = Toggle("Draw fences: right-drag on the Desktop", () => app.DrawOn, v => app.SetSetting("drawToCreate", v));
            quickHide = Toggle("Quick-hide: double-click the Desktop", () => app.QuickHideOn, v => app.SetSetting("quickHide", v));
            quickHideIcons = Toggle("Quick-hide hides Desktop icons too", () => app.QuickHideIconsOn, v => app.SetSetting("quickHideIcons", v));
            winSpace = Toggle("Peek with Win + Space", () => app.WinSpaceOn, v => app.SetSetting("winSpacePeek", v));
            autoStart = Toggle("Start with Windows", () => app.AutoStartOn, app.SetAutoStart);
            settingsMenu.DropDownItems.AddRange(new WF.ToolStripItem[] { draw, quickHide, quickHideIcons, winSpace, new WF.ToolStripSeparator(), autoStart });
            menu.Items.Add(settingsMenu);
            menu.Items.Add("Open data folder", null, (_, __) => app.Open(Storage.Dir));
            menu.Items.Add(new WF.ToolStripSeparator());
            menu.Items.Add("Quit DeskFence", null, (_, __) => app.Shutdown());
            menu.Opening += (_, __) => Refresh();

            icon = new WF.NotifyIcon
            {
                Text = "DeskFence",
                Icon = LoadIcon(),
                ContextMenuStrip = menu,
                Visible = true,
            };
            icon.DoubleClick += (_, __) => app.ToggleQuickHide();
        }

        WF.ToolStripMenuItem Toggle(string text, Func<bool> get, Action<bool> set)
        {
            var item = new WF.ToolStripMenuItem(text) { CheckOnClick = false };
            item.Click += (_, __) =>
            {
                try
                {
                    set(!get());
                }
                catch (Exception error)
                {
                    Log.Error("Setting " + text, error);
                }
                Refresh();
            };
            item.Tag = get;
            return item;
        }

        public void Refresh()
        {
            showHide.Text = app.QuickHidden ? "Show all fences" : "Hide all fences";
            foreach (var item in new[] { draw, quickHide, quickHideIcons, winSpace, autoStart })
                if (item.Tag is Func<bool> get) item.Checked = get();
        }

        public void Balloon(string message)
        {
            icon.ShowBalloonTip(5000, "DeskFence", message, WF.ToolTipIcon.None);
        }

        static Icon LoadIcon()
        {
            try
            {
                return Icon.ExtractAssociatedIcon(Environment.ProcessPath) ?? SystemIcons.Application;
            }
            catch
            {
                return SystemIcons.Application;
            }
        }

        public void Dispose()
        {
            icon.Visible = false;
            icon.Dispose();
        }
    }
}
