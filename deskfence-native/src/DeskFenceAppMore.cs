using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace DeskFence
{
    /// <summary>Scheduled cleanup, settings backup, the Focus layout and "drop a folder on the Desktop".</summary>
    internal sealed partial class DeskFenceApp
    {
        // ================= scheduled cleanup =================
        public JsonArray ScheduledTasks
        {
            get
            {
                if (settings["scheduledTasks"] is not JsonArray tasks)
                {
                    tasks = new JsonArray();
                    settings["scheduledTasks"] = tasks;
                }
                return tasks;
            }
        }

        public void SaveScheduledTasks() => Storage.SaveSettings(settings);

        public void OpenCleanup()
        {
            var dialog = new CleanupWindow(this);
            dialog.Show();
            dialog.Activate();
        }

        DispatcherTimer scheduler;
        readonly HashSet<string> runningTasks = new HashSet<string>();

        void StartScheduler()
        {
            scheduler = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) }; // first check soon after start (catch-up)
            scheduler.Tick += (_, __) =>
            {
                scheduler.Interval = TimeSpan.FromSeconds(60);
                RunDueTasks();
            };
            scheduler.Start();
        }

        void RunDueTasks()
        {
            var now = DateTime.Now;
            foreach (var task in ScheduledTasks.OfType<JsonObject>().ToList())
            {
                string id = Theme.Str(task["id"]) ?? "";
                if (runningTasks.Contains(id) || !Cleanup.IsDue(task, now)) continue;
                runningTasks.Add(id);
                var copy = (JsonObject)JsonNode.Parse(task.ToJsonString()); // the worker gets its own copy
                Task.Run(() => Cleanup.Run(copy, false)).ContinueWith(t =>
                {
                    ui.BeginInvoke(new Action(() =>
                    {
                        runningTasks.Remove(id);
                        var live = ScheduledTasks.OfType<JsonObject>().FirstOrDefault(x => Theme.Str(x["id"]) == id);
                        if (live == null) return; // deleted meanwhile
                        RecordRun(live, t.IsFaulted ? null : t.Result, t.Exception?.GetBaseException().Message);
                    }));
                });
            }
        }

        void RecordRun(JsonObject task, Cleanup.Result result, string error)
        {
            task["lastRun"] = DateTimeOffset.Now.ToUnixTimeMilliseconds();
            task["lastResult"] = error != null ? "failed: " + error : $"{result.Processed} done" + (result.Failed.Count > 0 ? $", {result.Failed.Count} failed" : "");
            Cleanup.SetNextRun(task, DateTime.Now);
            SaveScheduledTasks();
            if (error != null || result.Failed.Count > 0) Log.Info($"Cleanup \"{Theme.Str(task["name"])}\": {Theme.Str(task["lastResult"])}");
        }

        /// <summary>"Run now" from the dialog: runs it and returns a one-line result.</summary>
        public string RunCleanupNow(JsonObject task)
        {
            string id = Theme.Str(task["id"]) ?? "";
            if (runningTasks.Contains(id)) return "It is already running.";
            runningTasks.Add(id);
            try
            {
                Mouse.OverrideCursor = Cursors.Wait;
                var result = Cleanup.Run(task, false);
                RecordRun(task, result, null);
                return $"“{Theme.Str(task["name"])}”: {result.Processed} item(s) done" + (result.Failed.Count > 0 ? $", {result.Failed.Count} failed ({result.Failed[0].Error})" : ".");
            }
            catch (Exception e)
            {
                RecordRun(task, null, e.Message);
                return "Failed: " + e.Message;
            }
            finally
            {
                runningTasks.Remove(id);
                Mouse.OverrideCursor = null;
            }
        }

        // ================= settings backup =================
        JsonObject BackupDocument() => new JsonObject
        {
            ["app"] = "DeskFence",
            ["exportedAt"] = DateTime.Now.ToString("o", CultureInfo.InvariantCulture),
            ["fences"] = new JsonArray(fences.Select(f => JsonNode.Parse(f.Raw.ToJsonString())).ToArray()),
            ["settings"] = JsonNode.Parse(settings.ToJsonString()),
            ["widgets"] = JsonNode.Parse((widgetsState ?? Storage.LoadWidgets()).ToJsonString()),
        };

        string WriteBackup(string file)
        {
            File.WriteAllText(file, BackupDocument().ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            return file;
        }

        public void ExportBackup()
        {
            using var dialog = new System.Windows.Forms.SaveFileDialog
            {
                Title = "Save a DeskFence backup",
                Filter = "DeskFence backup (*.json)|*.json",
                FileName = "DeskFence-backup-" + DateTime.Now.ToString("yyyy-MM-dd") + ".json",
                InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            };
            if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
            try
            {
                WriteBackup(dialog.FileName);
                Notice("Backup saved: fences, rules, settings, widgets and to-do list.");
            }
            catch (Exception e)
            {
                MessageBox.Show("Could not save the backup: " + e.Message, "DeskFence");
            }
        }

        public void ImportBackup()
        {
            using var dialog = new System.Windows.Forms.OpenFileDialog { Title = "Restore a DeskFence backup", Filter = "DeskFence backup (*.json)|*.json" };
            if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
            JsonObject doc;
            try
            {
                doc = JsonNode.Parse(File.ReadAllText(dialog.FileName)) as JsonObject;
                if (doc?["fences"] is not JsonArray list || list.Any(f => f is not JsonObject o || Theme.Str(o["id"]) == null)) throw new InvalidDataException("this is not a DeskFence backup (no fences list)");
            }
            catch (Exception e)
            {
                MessageBox.Show("Could not read this file: " + e.Message, "DeskFence");
                return;
            }
            var imported = (JsonArray)doc["fences"];
            if (MessageBox.Show($"Replace your {fences.Count} fence(s) with the {imported.Count} in this backup?\n\nYour rules, settings, widgets and to-do list are replaced too. A copy of what you have now is saved first.",
                    "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;

            try { WriteBackup(Path.Combine(Storage.Dir, "before-restore-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json")); }
            catch (Exception e) { Log.Error("Safety copy before restore", e); }

            foreach (var w in windows.Values.ToList())
            {
                w.Closed -= OnWindowClosedUnexpectedly;
                w.Close();
            }
            windows.Clear();
            foreach (var f in fences) Unwatch(f);
            fences.Clear();
            foreach (var node in imported.OfType<JsonObject>()) fences.Add(new FenceData((JsonObject)JsonNode.Parse(node.ToJsonString())));
            if (doc["settings"] is JsonObject s) { settings = (JsonObject)JsonNode.Parse(s.ToJsonString()); Storage.SaveSettings(settings); ApplySettings(); }
            if (doc["widgets"] is JsonObject wd)
            {
                widgetsState = (JsonObject)JsonNode.Parse(wd.ToJsonString());
                SaveWidgetsNow();
                RebuildWidgets();
            }
            foreach (var fence in fences) OpenWindow(fence);
            foreach (var fence in fences) Reconcile(fence);
            RulesChanged();
            SaveNow();
            Notice($"Restored {fences.Count} fence(s).");
        }

        // ================= the Focus layout =================
        public void ApplyFocusLayout()
        {
            var monitor = Native.Monitors().FirstOrDefault(m => m.Primary) ?? Native.Monitors().First();
            var onMain = fences.Where(f => string.IsNullOrEmpty(f.ScreenDevice) || string.Equals(f.ScreenDevice, monitor.Device, StringComparison.OrdinalIgnoreCase)).ToList();
            string intro = onMain.Count > 0
                ? $"Replace the {onMain.Count} fence(s) on your main monitor with the Focus layout (10 fences)?\n\n• Files you moved into those fences go back to the Desktop.\n• Shortcut-only items just leave; nothing is deleted.\n• A backup of everything is saved first."
                : "Create the Focus layout (10 fences) on your main monitor?";
            if (MessageBox.Show(intro, "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;

            try { WriteBackup(Path.Combine(Storage.Dir, "before-layout-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json")); }
            catch (Exception e) { Log.Error("Backup before layout", e); }

            Mouse.OverrideCursor = Cursors.Wait;
            var kept = new List<string>();
            var missing = new List<string>();
            int created = 0, items = 0;
            try
            {
                // 1. clear the main monitor (a fence whose files cannot go back stays)
                foreach (var old in onMain)
                {
                    var owned = old.AllItems().Where(i => OwnsFile(old, Theme.Str(i["path"]))).Select(i => Theme.Str(i["path"])).ToList();
                    if (owned.Count > 0 && string.IsNullOrEmpty(old.PortalPath))
                    {
                        Unwatch(old);
                        foreach (var p in owned) NoteLeaving(p);
                        var r = FileOps.MoveInto(owned, DesktopPath());
                        if (r.Failed.Count > 0)
                        {
                            Watch(old);
                            Reconcile(old);
                            kept.Add(old.Name);
                            continue;
                        }
                    }
                    Unwatch(old);
                    fences.Remove(old);
                    if (windows.TryGetValue(old.Id, out var w))
                    {
                        windows.Remove(old.Id);
                        w.Closed -= OnWindowClosedUnexpectedly;
                        w.Close();
                    }
                }

                // 2. the user's own shortcuts, by name
                var found = FocusLayout.Find();

                // 3. build the ten fences, scaled to this monitor
                double workW = (monitor.Work.Right - monitor.Work.Left) / monitor.Scale;
                double workH = (monitor.Work.Bottom - monitor.Work.Top) / monitor.Scale;
                double sx = workW / FocusLayout.DesignW, sy = workH / FocusLayout.DesignH, scale = Math.Min(sx, sy);
                foreach (var def in FocusLayout.Preset)
                {
                    var fence = FenceData.Create(def.Name, def.X * sx, def.Y * sy, def.W * sx, def.H * sy, monitor.Device);
                    fence.Raw["style"] = new JsonObject
                    {
                        ["backgroundColor"] = "rgba(16, 25, 46, 0.82)",
                        ["borderColor"] = "rgba(255, 255, 255, 0.14)",
                        ["borderWidth"] = 1,
                        ["opacity"] = 1,
                        ["labelColor"] = "#ffffff",
                        ["labelSize"] = Math.Round(16 * scale),
                        ["borderRadius"] = 14,
                        ["iconPx"] = Math.Round(46 * scale),
                        ["itemLabelSize"] = Math.Round(12.5 * scale * 2) / 2,
                        ["columns"] = 4,
                        ["compactHeader"] = true,
                    };
                    foreach (var item in def.Items)
                    {
                        if (!found.TryGetValue(item, out var path) || path == null)
                        {
                            missing.Add($"{item.Label} (in {def.Name})");
                            continue;
                        }
                        var added = fence.AddItem(path, item.Folder ? "folder" : item.Special != null ? "shortcut" : "app");
                        added["name"] = item.Label;
                        items++;
                    }
                    fences.Add(fence);
                    OpenWindow(fence);
                    created++;
                }
                SaveNow();
            }
            finally
            {
                Mouse.OverrideCursor = null;
            }
            var lines = new List<string> { $"Created {created} fences with {items} items." };
            if (missing.Count > 0) lines.Add("Not found on this PC (drag them onto the fence later): " + string.Join(", ", missing) + ".");
            if (kept.Count > 0) lines.Add("Left in place because their files could not go back to the Desktop: " + string.Join(", ", kept) + ".");
            MessageBox.Show(string.Join("\n\n", lines), "DeskFence");
        }

        // ================= a folder dragged from Explorer onto the bare Desktop -> a fence showing it =================
        public bool DropFolderOn => Setting("dropFolderToFence", true);
        readonly List<DropCatcher> catchers = new List<DropCatcher>();
        DispatcherTimer catcherCloseTimer;

        /// <summary>A drag started in an Explorer window: lay a drop catcher over the bare Desktop (below every window).</summary>
        void OnExplorerDragStarted()
        {
            if (!DropFolderOn || QuickHidden || Peeking || catchers.Count > 0) return;
            catcherCloseTimer?.Stop();
            foreach (var monitor in Native.Monitors())
            {
                var c = new DropCatcher(this);
                catchers.Add(c);
                c.CoverBelowWindows(monitor.Work);
            }
        }

        void OnExplorerDragEnded()
        {
            // the drop itself arrives around the button release: close a moment later
            catcherCloseTimer ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(700) };
            catcherCloseTimer.Tick -= CloseCatchers;
            catcherCloseTimer.Tick += CloseCatchers;
            catcherCloseTimer.Stop();
            catcherCloseTimer.Start();
        }

        void CloseCatchers(object sender, EventArgs e)
        {
            catcherCloseTimer.Stop();
            foreach (var c in catchers.ToList()) c.Close();
            catchers.Clear();
        }

        /// <summary>The drag holds no folder: get out of the way so the Desktop takes the drop as usual.</summary>
        public void StepAsideCatchers()
        {
            foreach (var c in catchers) c.Hide();
        }

        public void CreatePortalFences(string[] folders, Native.POINT at)
        {
            int made = 0;
            var existing = new List<string>();
            foreach (var folder in folders)
            {
                if (fences.Any(f => !string.IsNullOrEmpty(f.PortalPath) && FileOps.SamePath(f.PortalPath, folder)))
                {
                    existing.Add(Path.GetFileName(folder.TrimEnd('\\')));
                    continue;
                }
                var m = Native.MonitorAt(at);
                double x = (at.X - m.Work.Left) / m.Scale + made * 30, y = (at.Y - m.Work.Top) / m.Scale + made * 30;
                var fence = FenceData.Create(Path.GetFileName(folder.TrimEnd('\\')) is string n && n.Length > 0 ? n : folder, Math.Max(0, x - 40), Math.Max(0, y - 20), 420, 300, m.Device);
                fence.PortalPath = folder;
                fences.Add(fence);
                OpenWindow(fence);
                Reconcile(fence);
                if (windows.TryGetValue(fence.Id, out var w)) w.Refresh();
                made++;
            }
            SaveSoon();
            if (existing.Count > 0) Notice(string.Join(", ", existing) + (existing.Count == 1 ? " already has a fence." : " already have fences."));
        }
    }

    /// <summary>
    /// A transparent layer just above the wallpaper (below every window and fence) that exists only
    /// while something is dragged from Explorer: a FOLDER dropped on it becomes a fence showing that
    /// folder. A drag without folders (or with Shift held) makes it step aside, so the Desktop works as usual.
    /// </summary>
    internal sealed class DropCatcher : Window
    {
        readonly DeskFenceApp app;
        readonly Border hint = new Border();
        IntPtr hwnd;

        public DropCatcher(DeskFenceApp app)
        {
            this.app = app;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = new SolidColorBrush(Color.FromArgb(1, 0, 0, 0)); // invisible, but takes the drop
            ShowInTaskbar = false;
            ShowActivated = false;
            ResizeMode = ResizeMode.NoResize;
            AllowDrop = true;
            Left = -32000;
            Top = -32000;
            Width = 1;
            Height = 1;
            hint.Background = new SolidColorBrush(Color.FromArgb(200, 17, 24, 39));
            hint.CornerRadius = new CornerRadius(8);
            hint.Padding = new Thickness(14, 8, 14, 8);
            hint.HorizontalAlignment = HorizontalAlignment.Center;
            hint.VerticalAlignment = VerticalAlignment.Bottom;
            hint.Margin = new Thickness(0, 0, 0, 60);
            hint.Visibility = Visibility.Collapsed;
            hint.IsHitTestVisible = false;
            hint.Child = new TextBlock { Text = "Drop the folder here to make a fence showing it  ·  hold Shift to drop on the Desktop", Foreground = Brushes.White, FontSize = 13 };
            Content = new Grid { Children = { hint } };
            DragEnter += OnDrag;
            DragOver += OnDrag;
            DragLeave += (_, __) => hint.Visibility = Visibility.Collapsed;
            Drop += OnDrop;
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            hwnd = new WindowInteropHelper(this).Handle;
            Native.SetExStyle(hwnd, (Native.GetExStyle(hwnd) | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE) & ~Native.WS_EX_APPWINDOW);
            IntPtr host = Native.DesktopHost();
            if (host != IntPtr.Zero) Native.SetWindowLongPtr(hwnd, Native.GWLP_HWNDPARENT, host);
        }

        /// <summary>Covers the monitor at the very bottom: above the wallpaper, under the fences and every app.</summary>
        public void CoverBelowWindows(Native.RECT r)
        {
            if (hwnd == IntPtr.Zero) Show();
            Native.SetWindowPos(hwnd, Native.HWND_BOTTOM, r.Left, r.Top, Math.Max(1, r.Right - r.Left), Math.Max(1, r.Bottom - r.Top), Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
        }

        static string[] Folders(DragEventArgs e) =>
            e.Data.GetData(DataFormats.FileDrop) is string[] paths ? paths.Where(Directory.Exists).ToArray() : Array.Empty<string>();

        void OnDrag(object sender, DragEventArgs e)
        {
            bool shift = (e.KeyStates & DragDropKeyStates.ShiftKey) != 0;
            if (shift || Folders(e).Length == 0)
            {
                e.Effects = DragDropEffects.None;
                e.Handled = true;
                // let the Desktop have this drag: hide (on the next tick, not inside the drag event)
                Dispatcher.BeginInvoke(new Action(app.StepAsideCatchers));
                return;
            }
            e.Effects = DragDropEffects.Link; // nothing is moved: the fence just shows the folder
            hint.Visibility = Visibility.Visible;
            e.Handled = true;
        }

        void OnDrop(object sender, DragEventArgs e)
        {
            hint.Visibility = Visibility.Collapsed;
            var folders = Folders(e);
            e.Effects = folders.Length > 0 ? DragDropEffects.Link : DragDropEffects.None;
            e.Handled = true;
            if (folders.Length == 0) return;
            Native.GetCursorPos(out var at);
            Dispatcher.BeginInvoke(new Action(() => app.CreatePortalFences(folders, at)));
        }
    }
}
