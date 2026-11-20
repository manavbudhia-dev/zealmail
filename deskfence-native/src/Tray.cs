using System;
using System.Collections.Generic;
using System.Drawing;
using WF = System.Windows.Forms;

namespace DeskFence
{
    /// <summary>The notification-area icon; its menu is the same Windows 11 style menu as the fences'.</summary>
    internal sealed class Tray : IDisposable
    {
        readonly DeskFenceApp app;
        readonly WF.NotifyIcon icon;

        public Tray(DeskFenceApp app)
        {
            this.app = app;
            icon = new WF.NotifyIcon
            {
                Text = "DeskFence",
                Icon = LoadIcon(),
                Visible = true,
            };
            icon.MouseUp += (_, e) =>
            {
                if (e.Button == WF.MouseButtons.Right) ShowMenu();
            };
            icon.DoubleClick += (_, __) => app.ToggleQuickHide();
        }

        void ShowMenu()
        {
            var settings = new List<MenuEntry>
            {
                MenuEntry.Toggle("Draw fences: right-drag on the Desktop", app.DrawOn, () => Set("drawToCreate", !app.DrawOn)),
                MenuEntry.Toggle("Quick-hide: double-click the Desktop", app.QuickHideOn, () => Set("quickHide", !app.QuickHideOn)),
                MenuEntry.Toggle("Quick-hide hides Desktop icons too", app.QuickHideIconsOn, () => Set("quickHideIcons", !app.QuickHideIconsOn)),
                MenuEntry.Toggle("Peek with Win + Space", app.WinSpaceOn, () => Set("winSpacePeek", !app.WinSpaceOn)),
                MenuEntry.Separator(),
                MenuEntry.Toggle("Start with Windows", app.AutoStartOn, () => Safe(() => app.SetAutoStart(!app.AutoStartOn))),
            };
            var entries = new List<MenuEntry>
            {
                MenuEntry.Item(Glyphs.NewFence, "New fence", app.StartDrawMode),
                MenuEntry.Item(app.QuickHidden ? Glyphs.Peek : Glyphs.Hide, app.QuickHidden ? "Show all fences" : "Hide all fences", app.ToggleQuickHide),
                new MenuEntry { Glyph = Glyphs.Peek, Text = "Peek: fences above windows", Shortcut = "Win+Space", Run = () => app.SetPeek(true) },
                MenuEntry.Toggle("Privacy mode (hide all fence contents)", app.PrivacyAll, () => Safe(() => app.SetPrivacyAll(!app.PrivacyAll))),
                MenuEntry.Separator(),
                MenuEntry.Item(Glyphs.Organize, "Organize my Desktop…", app.OrganizeDesktop),
                MenuEntry.Item(Glyphs.Rules, "Automation rules…", app.OpenAutomation),
                MenuEntry.Separator(),
                MenuEntry.Sub(Glyphs.Settings, "Settings", settings),
                MenuEntry.Item(Glyphs.Data, "Open data folder", () => app.Open(Storage.Dir)),
                MenuEntry.Separator(),
                MenuEntry.Item(Glyphs.Power, "Quit DeskFence", app.Shutdown),
            };
            FluentMenu.ShowAtCursor(entries);
        }

        void Set(string key, bool value) => Safe(() => app.SetSetting(key, value));

        static void Safe(Action action)
        {
            try
            {
                action();
            }
            catch (Exception error)
            {
                Log.Error("Tray setting", error);
            }
        }

        /// <summary>Kept for callers that update the tray after a change (the menu is built fresh each time).</summary>
        public void Refresh() { }

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
