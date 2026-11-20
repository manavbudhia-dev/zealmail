using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.Win32;

namespace DeskFence
{
    /// <summary>The whole app: fences, their windows and folders, Desktop gestures, Peek, Quick-hide.</summary>
    internal sealed class DeskFenceApp
    {
        readonly Dispatcher ui = Dispatcher.CurrentDispatcher;
        readonly List<FenceData> fences;
        readonly Dictionary<string, FenceWindow> windows = new Dictionary<string, FenceWindow>();
        readonly Dictionary<string, FileSystemWatcher> watchers = new Dictionary<string, FileSystemWatcher>();
        readonly Dictionary<string, DispatcherTimer> reconcileTimers = new Dictionary<string, DispatcherTimer>();
        readonly DispatcherTimer saveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        JsonObject settings;
        DesktopHooks hooks;
        Tray tray;
        HwndSource messageWindow;
        uint taskbarCreatedMessage;

        public bool Peeking { get; private set; }
        public bool QuickHidden { get; private set; }
        bool iconsHiddenByUs;
        readonly List<DimWindow> dims = new List<DimWindow>();
        RubberBand band;
        Native.POINT drawStart;
        DispatcherTimer drawTimer;
        readonly List<DrawModeWindow> drawModes = new List<DrawModeWindow>();

        public DeskFenceApp()
        {
            fences = Storage.LoadFences();
            settings = Storage.LoadSettings();
            saveTimer.Tick += (_, __) => SaveNow();
        }

        // ================= start / stop =================
        public void Start()
        {
            Log.Info("Starting with " + fences.Count + " fence(s)");
            FirstRunRepair();
            foreach (var fence in fences) OpenWindow(fence);
            foreach (var fence in fences) Reconcile(fence);

            hooks = new DesktopHooks(ui);
            hooks.QuickHideRequested += _ => ToggleQuickHide();
            hooks.PeekToggled += () => SetPeek(!Peeking);
            hooks.EscapePressed += () =>
            {
                if (Peeking) SetPeek(false);
                CancelDrawMode();
            };
            hooks.DrawStarted += OnDrawStarted;
            hooks.DrawEnded += OnDrawEnded;
            hooks.DrawCancelled += EndRubberBand;
            ApplySettings();
            hooks.Start();

            tray = new Tray(this);

            // A hidden window for system messages: Explorer restarting, monitors changing
            var parameters = new HwndSourceParameters("DeskFenceMessages") { Width = 0, Height = 0, WindowStyle = 0 };
            messageWindow = new HwndSource(parameters);
            taskbarCreatedMessage = Native.RegisterWindowMessage("TaskbarCreated");
            messageWindow.AddHook(SystemMessages);
            SystemEvents.DisplaySettingsChanged += (_, __) => ui.BeginInvoke(new Action(() =>
            {
                foreach (var w in windows.Values) w.Place();
            }));
        }

        // The installer force-closes the earlier (Electron) DeskFence. If Quick-hide had the Desktop icons
        // hidden at that moment, nothing brought them back: do it once, unless hiding them was a setting.
        void FirstRunRepair()
        {
            string marker = Path.Combine(Storage.Dir, "native-first-run.done");
            if (File.Exists(marker)) return;
            try
            {
                if (!Setting("hideDesktopIcons", false) && DesktopIcons.AreHidden()) DesktopIcons.SetHidden(false);
                Directory.CreateDirectory(Storage.Dir);
                File.WriteAllText(marker, DateTime.Now.ToString("o"));
            }
            catch (Exception error)
            {
                Log.Error("First run", error);
            }
        }

        IntPtr SystemMessages(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg == taskbarCreatedMessage && taskbarCreatedMessage != 0)
            {
                // Explorer restarted: the Desktop window our fences belong to is new
                Log.Info("Explorer restarted: re-attaching fences");
                ui.BeginInvoke(DispatcherPriority.Background, new Action(RebuildWindows));
            }
            return IntPtr.Zero;
        }

        void RebuildWindows()
        {
            foreach (var w in windows.Values.ToList())
            {
                w.Closed -= OnWindowClosedUnexpectedly;
                w.Close();
            }
            windows.Clear();
            foreach (var fence in fences) OpenWindow(fence);
            if (QuickHidden) foreach (var w in windows.Values) w.Hide();
        }

        public void Shutdown()
        {
            SaveNow();
            if (iconsHiddenByUs) DesktopIcons.SetHidden(false); // never leave the Desktop icons hidden
            tray?.Dispose();
            foreach (var watcher in watchers.Values) watcher.Dispose();
            Application.Current.Shutdown();
        }

        // ================= settings =================
        bool Setting(string key, bool fallback) => settings[key] is JsonValue v && v.TryGetValue(out bool b) ? b : fallback;

        public bool QuickHideOn => Setting("quickHide", true);
        public bool QuickHideIconsOn => Setting("quickHideIcons", true);
        public bool WinSpaceOn => Setting("winSpacePeek", true);
        public bool DrawOn => Setting("drawToCreate", true);
        public bool AutoStartOn => AutoStart.IsOn;

        public void SetSetting(string key, bool value)
        {
            settings[key] = value;
            Storage.SaveSettings(settings);
            ApplySettings();
        }

        public void SetAutoStart(bool on) => AutoStart.Set(on);

        void ApplySettings()
        {
            hooks.QuickHideEnabled = QuickHideOn;
            hooks.PeekKeyEnabled = WinSpaceOn;
            hooks.DrawEnabled = DrawOn;
            hooks.FencesVisible = !QuickHidden;
        }

        // ================= windows =================
        void OpenWindow(FenceData fence)
        {
            var window = new FenceWindow(this, fence);
            windows[fence.Id] = window;
            window.Closed += OnWindowClosedUnexpectedly;
            window.Show();
            Watch(fence);
        }

        // An owned window dies with its owner (Explorer crash): bring it back
        void OnWindowClosedUnexpectedly(object sender, EventArgs e)
        {
            var window = (FenceWindow)sender;
            if (!fences.Contains(window.Data) || !windows.TryGetValue(window.Data.Id, out var current) || current != window) return;
            windows.Remove(window.Data.Id);
            ui.BeginInvoke(DispatcherPriority.Background, new Action(() =>
            {
                if (fences.Contains(window.Data) && !windows.ContainsKey(window.Data.Id)) OpenWindow(window.Data);
            }));
        }

        public void SaveSoon()
        {
            saveTimer.Stop();
            saveTimer.Start();
        }

        void SaveNow()
        {
            saveTimer.Stop();
            try
            {
                Storage.SaveFences(fences);
            }
            catch (Exception error)
            {
                Log.Error("Saving fences", error);
            }
        }

        public void Notice(string message) => tray?.Balloon(message);

        // ================= creating / deleting fences =================
        /// <summary>A rectangle in screen pixels becomes a fence (a tiny one gets the default size).</summary>
        public void CreateFenceAt(Native.RECT rect)
        {
            var center = new Native.POINT { X = (rect.Left + rect.Right) / 2, Y = (rect.Top + rect.Bottom) / 2 };
            var monitor = Native.MonitorAt(center);
            double w = (rect.Right - rect.Left) / monitor.Scale;
            double h = (rect.Bottom - rect.Top) / monitor.Scale;
            bool drawn = w >= 40 && h >= 40;
            double x = (rect.Left - monitor.Work.Left) / monitor.Scale;
            double y = (rect.Top - monitor.Work.Top) / monitor.Scale;
            var fence = FenceData.Create("New Fence", Math.Max(0, x), Math.Max(0, y), drawn ? Math.Max(160, w) : 300, drawn ? Math.Max(80, h) : 220, monitor.Device);
            fences.Add(fence);
            OpenWindow(fence);
            SaveSoon();
            windows[fence.Id].BeginRenameSoon();
        }

        public void DeleteFence(FenceWindow window)
        {
            var fence = window.Data;
            var owned = fence.AllItems().Where(i => OwnsFile(fence, Theme.Str(i["path"]))).ToList();
            string message = owned.Count > 0
                ? $"Delete fence \"{fence.Name}\"?\n\nIts {owned.Count} file(s)/folder(s) go back to your Desktop."
                : !string.IsNullOrEmpty(fence.PortalPath)
                    ? $"Delete fence \"{fence.Name}\"?\n\nThe folder it shows and its files are not touched."
                    : $"Delete fence \"{fence.Name}\"?";
            if (MessageBox.Show(message, "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;

            if (owned.Count > 0)
            {
                Unwatch(fence); // the files leave: do not react to it
                var result = FileOps.MoveInto(owned.Select(i => Theme.Str(i["path"])), DesktopPath());
                if (result.Failed.Count > 0)
                {
                    Watch(fence);
                    Reconcile(fence);
                    MessageBox.Show("The fence was NOT deleted because some items could not go back to the Desktop:\n\n" + Describe(result.Failed), "DeskFence", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
            }
            Unwatch(fence);
            fences.Remove(fence);
            windows.Remove(fence.Id);
            window.Closed -= OnWindowClosedUnexpectedly;
            window.Close();
            SaveSoon();
        }

        // ================= files =================
        public static string DesktopPath() => Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);

        /// <summary>True when the file really lives in this fence's folder (moved in), not a shortcut-only item.</summary>
        public bool OwnsFile(FenceData fence, string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            if (!string.IsNullOrEmpty(fence.PortalPath)) return FileOps.IsInside(path, fence.PortalPath);
            return !string.IsNullOrEmpty(fence.StoragePath) && FileOps.IsInside(path, fence.StoragePath);
        }

        string FolderOf(FenceData fence)
        {
            if (!string.IsNullOrEmpty(fence.PortalPath)) return fence.PortalPath;
            if (string.IsNullOrEmpty(fence.StoragePath) || !Directory.Exists(fence.StoragePath))
            {
                fence.StoragePath = FileOps.FenceFolder(fence.Name, fence.Id);
                SaveSoon();
                Watch(fence);
            }
            return fence.StoragePath;
        }

        /// <summary>Files dropped on a fence move into its folder (Ctrl = copy).</summary>
        public void DropInto(FenceWindow window, string[] paths, bool copy)
        {
            var fence = window.Data;
            string folder = FolderOf(fence);
            var wanted = paths.Where(p => !FileOps.SamePath(Path.GetDirectoryName(p.TrimEnd('\\', '/')) ?? "", folder)).ToList();
            if (wanted.Count == 0) return;
            var result = FileOps.MoveInto(wanted, folder, copy);
            if (string.IsNullOrEmpty(fence.PortalPath))
            {
                foreach (var (_, to) in result.Moved)
                {
                    if (fence.AllItems().Any(i => string.Equals(Theme.Str(i["path"]), to, StringComparison.OrdinalIgnoreCase))) continue;
                    fence.AddItem(to, Directory.Exists(to) ? "folder" : "file");
                }
            }
            Reconcile(fence);
            SaveSoon();
            // the items were added above, so Reconcile found "nothing new" and did not redraw: do it here
            window.Refresh();
            if (result.Failed.Count > 0)
                MessageBox.Show("Some items could not be moved:\n\n" + Describe(result.Failed), "DeskFence", MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        public void MoveItemToDesktop(FenceWindow window, JsonObject item)
        {
            var result = FileOps.MoveInto(new[] { Theme.Str(item["path"]) }, DesktopPath());
            if (result.Failed.Count > 0)
            {
                MessageBox.Show("Could not move it to the Desktop:\n\n" + Describe(result.Failed), "DeskFence", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            window.Data.RemoveItem(Theme.Str(item["id"]));
            SaveSoon();
            window.Refresh();
        }

        public void RemoveItem(FenceWindow window, JsonObject item)
        {
            window.Data.RemoveItem(Theme.Str(item["id"]));
            SaveSoon();
            window.Refresh();
        }

        public void DeleteItemFile(FenceWindow window, JsonObject item)
        {
            string path = Theme.Str(item["path"]);
            string name = ItemTile.DisplayName(Path.GetFileName(path.TrimEnd('\\', '/')));
            if (MessageBox.Show($"Send \"{name}\" to the Recycle Bin?", "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;
            if (!Native.SendToRecycleBin(path))
            {
                MessageBox.Show($"\"{name}\" could not be deleted (it may be in use).", "DeskFence", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            window.Data.RemoveItem(Theme.Str(item["id"]));
            SaveSoon();
            window.Refresh();
        }

        public void AfterDragOut(FenceWindow window) => ScheduleReconcile(window.Data);

        static string Describe(List<(string Path, string Error)> failed) =>
            string.Join("\n", failed.Select(f => "• " + Path.GetFileName(f.Path.TrimEnd('\\', '/')) + ": " + f.Error));

        // ================= opening =================
        public void OpenItem(FenceWindow window, JsonObject item)
        {
            if (Peeking) SetPeek(false); // what you open comes to the front; the fences go back down
            Open(Theme.Str(item["path"]));
        }

        public void Open(string path)
        {
            try
            {
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            }
            catch (Exception error)
            {
                Notice("Could not open " + Path.GetFileName(path) + ": " + error.Message);
            }
        }

        public void ShowInFolder(string path)
        {
            try
            {
                Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + path + "\"") { UseShellExecute = true });
            }
            catch (Exception error)
            {
                Log.Error("Show in folder", error);
            }
        }

        // ================= linked folders =================
        public void LinkFolder(FenceWindow window)
        {
            var fence = window.Data;
            if (fence.AllItems().Any(i => OwnsFile(fence, Theme.Str(i["path"]))))
            {
                MessageBox.Show("This fence holds files that were moved into it. Move them back to the Desktop first (right-click an item), then show a folder in it.", "DeskFence", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            using var dialog = new System.Windows.Forms.FolderBrowserDialog { Description = "Show this folder's contents in the fence", UseDescriptionForTitle = true };
            if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK || string.IsNullOrEmpty(dialog.SelectedPath)) return;
            Unwatch(fence);
            fence.PortalPath = dialog.SelectedPath;
            if (fence.Name == "New Fence") fence.Name = Path.GetFileName(dialog.SelectedPath.TrimEnd('\\')) is string n && n.Length > 0 ? n : fence.Name;
            fence.ReplaceItems(new JsonArray());
            Watch(fence);
            Reconcile(fence);
            SaveSoon();
            window.Refresh();
        }

        public void UnlinkFolder(FenceWindow window)
        {
            var fence = window.Data;
            Unwatch(fence);
            fence.PortalPath = null;
            fence.ReplaceItems(new JsonArray());
            SaveSoon();
            window.Refresh();
        }

        // ================= folder watching: the fence follows its folder =================
        void Watch(FenceData fence)
        {
            Unwatch(fence);
            string folder = !string.IsNullOrEmpty(fence.PortalPath) ? fence.PortalPath : fence.StoragePath;
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) return;
            try
            {
                var watcher = new FileSystemWatcher(folder)
                {
                    IncludeSubdirectories = false,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName,
                    InternalBufferSize = 64 * 1024,
                };
                FileSystemEventHandler changed = (_, __) => ScheduleReconcile(fence);
                watcher.Created += changed;
                watcher.Deleted += changed;
                watcher.Renamed += (_, __) => ScheduleReconcile(fence);
                watcher.Error += (_, __) => ScheduleReconcile(fence);
                watcher.EnableRaisingEvents = true;
                watchers[fence.Id] = watcher;
            }
            catch (Exception error)
            {
                Log.Error("Watching " + folder, error);
            }
        }

        void Unwatch(FenceData fence)
        {
            if (watchers.TryGetValue(fence.Id, out var watcher))
            {
                watcher.Dispose();
                watchers.Remove(fence.Id);
            }
        }

        // many file events in a burst -> one update, a moment later, on the UI thread
        void ScheduleReconcile(FenceData fence)
        {
            ui.BeginInvoke(new Action(() =>
            {
                if (!reconcileTimers.TryGetValue(fence.Id, out var timer))
                {
                    timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
                    timer.Tick += (_, __) =>
                    {
                        timer.Stop();
                        if (fences.Contains(fence)) Reconcile(fence);
                    };
                    reconcileTimers[fence.Id] = timer;
                }
                timer.Stop();
                timer.Start();
            }));
        }

        static readonly HashSet<string> SystemFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "desktop.ini", "thumbs.db" };

        static List<FileSystemInfo> Listing(string folder)
        {
            try
            {
                return new DirectoryInfo(folder).EnumerateFileSystemInfos()
                    .Where(f => !f.Name.StartsWith(".") && !SystemFiles.Contains(f.Name) && (f.Attributes & FileAttributes.Hidden) == 0)
                    .ToList();
            }
            catch
            {
                return null; // offline / missing: leave the fence as it is
            }
        }

        /// <summary>Brings a fence in line with its folder (files added or removed outside DeskFence too).</summary>
        void Reconcile(FenceData fence)
        {
            bool changed = false;
            if (!string.IsNullOrEmpty(fence.PortalPath))
            {
                // a linked folder: the fence shows exactly the folder (ids/positions kept per path)
                var files = Listing(fence.PortalPath);
                if (files == null) return;
                var byPath = fence.Items.OfType<JsonObject>().GroupBy(i => Theme.Str(i["path"]) ?? "", StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
                var next = new JsonArray();
                foreach (var f in SortInfos(files, Theme.Str(fence.Raw["sortBy"]) ?? "name"))
                {
                    byPath.TryGetValue(f.FullName, out var previous);
                    var item = new JsonObject
                    {
                        ["id"] = Theme.Str(previous?["id"]) ?? FenceData.NewId("item"),
                        ["name"] = f.Name,
                        ["path"] = f.FullName,
                        ["type"] = f is DirectoryInfo ? "folder" : "file",
                        ["position"] = new JsonObject { ["x"] = 0, ["y"] = 0 },
                        ["modified"] = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds(),
                    };
                    if (f is FileInfo fi) item["size"] = fi.Length;
                    next.Add(item);
                }
                if (next.ToJsonString() != fence.Items.ToJsonString())
                {
                    fence.ReplaceItems(next);
                    changed = true;
                }
            }
            else if (!string.IsNullOrEmpty(fence.StoragePath) && Directory.Exists(fence.StoragePath))
            {
                // the fence's own folder: drop items whose file is gone, add files that appeared
                var files = Listing(fence.StoragePath);
                if (files == null) return;
                var onDisk = new HashSet<string>(files.Select(f => f.FullName), StringComparer.OrdinalIgnoreCase);
                foreach (var item in fence.AllItems().ToList())
                {
                    string path = Theme.Str(item["path"]);
                    if (OwnsFile(fence, path) && !onDisk.Contains(path))
                    {
                        fence.RemoveItem(Theme.Str(item["id"]));
                        changed = true;
                    }
                }
                var known = new HashSet<string>(fence.AllItems().Select(i => Theme.Str(i["path"]) ?? ""), StringComparer.OrdinalIgnoreCase);
                foreach (var f in files)
                {
                    if (known.Contains(f.FullName)) continue;
                    fence.AddItem(f.FullName, f is DirectoryInfo ? "folder" : "file");
                    changed = true;
                }
            }
            if (changed)
            {
                SaveSoon();
                if (windows.TryGetValue(fence.Id, out var w)) w.Refresh();
            }
        }

        // ================= Sort by / Refresh =================
        /// <summary>Folders first (like Explorer), then by name, date modified (newest first), type or size.</summary>
        static IEnumerable<FileSystemInfo> SortInfos(IEnumerable<FileSystemInfo> files, string key)
        {
            var folders = files.OrderBy(f => f is FileInfo ? 1 : 0);
            switch (key)
            {
                case "modified": return folders.ThenByDescending(f => f.LastWriteTimeUtc).ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase);
                case "type": return folders.ThenBy(f => f is FileInfo ? f.Extension.ToLowerInvariant() : "").ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase);
                case "size": return folders.ThenBy(f => f is FileInfo fi ? fi.Length : 0).ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase);
                default: return folders.ThenBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase);
            }
        }

        static FileSystemInfo InfoOf(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            if (Directory.Exists(path)) return new DirectoryInfo(path);
            if (File.Exists(path)) return new FileInfo(path);
            return null;
        }

        /// <summary>Arranges the visible items like the Desktop's "Sort by" (a linked folder keeps that order).</summary>
        public void SortFence(FenceWindow window, string key)
        {
            var fence = window.Data;
            fence.Raw["sortBy"] = key;
            if (string.IsNullOrEmpty(fence.PortalPath))
            {
                var items = fence.Items.OfType<JsonObject>().ToList();
                // items whose file is gone (shortcut-only references) go last, in their order
                var withInfo = items.Select(i => (Item: i, Info: InfoOf(Theme.Str(i["path"])))).ToList();
                var present = withInfo.Where(x => x.Info != null).ToList();
                var ordered = SortInfos(present.Select(x => x.Info), key).Select(info => present.First(x => x.Info == info).Item).ToList();
                ordered.AddRange(withInfo.Where(x => x.Info == null).Select(x => x.Item));
                var next = new JsonArray();
                foreach (var item in ordered) next.Add(JsonNode.Parse(item.ToJsonString()));
                fence.ReplaceItems(next);
            }
            else
            {
                fence.Touch();
                Reconcile(fence);
            }
            SaveSoon();
            window.Refresh();
        }

        /// <summary>Re-reads the fence's folder and reloads every icon.</summary>
        public void RefreshFence(FenceWindow window)
        {
            foreach (var item in window.Data.AllItems()) ShellIcons.Forget(Theme.Str(item["path"]) ?? "");
            Reconcile(window.Data);
            window.Refresh();
        }

        // ================= Quick-hide =================
        public void ToggleQuickHide() => SetQuickHidden(!QuickHidden);

        public void SetQuickHidden(bool hidden)
        {
            if (hidden && Peeking) SetPeek(false);
            QuickHidden = hidden;
            hooks.FencesVisible = !hidden;
            foreach (var w in windows.Values)
            {
                if (hidden) w.Hide();
                else
                {
                    w.Show();
                    w.SendToBottom();
                }
            }
            // the real Desktop icons go and come back with the fences (only if we hid them)
            if (QuickHideIconsOn && hidden && !DesktopIcons.AreHidden())
            {
                iconsHiddenByUs = DesktopIcons.SetHidden(true);
            }
            else if (!hidden && iconsHiddenByUs)
            {
                DesktopIcons.SetHidden(false);
                iconsHiddenByUs = false;
            }
            tray?.Refresh();
        }

        // ================= Peek =================
        public void SetPeek(bool on)
        {
            if (on == Peeking) return;
            if (on && QuickHidden) SetQuickHidden(false);
            Peeking = on;
            hooks.PeekActive = on;
            if (on)
            {
                foreach (var monitor in Native.Monitors())
                {
                    var dim = new DimWindow();
                    dim.Clicked += () => SetPeek(false);
                    dim.Cover(monitor.Bounds);
                    dims.Add(dim);
                }
                foreach (var w in windows.Values) w.SetTopmost(true); // above the dimmed screen
            }
            else
            {
                foreach (var dim in dims) dim.Close();
                dims.Clear();
                foreach (var w in windows.Values) w.SetTopmost(false); // back down onto the Desktop
            }
        }

        // ================= drawing a fence =================
        void OnDrawStarted(Native.POINT start)
        {
            if (QuickHidden || Peeking) return;
            drawStart = start;
            band ??= new RubberBand();
            band.Span(start, start);
            drawTimer ??= new DispatcherTimer(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(15) };
            drawTimer.Tick -= FollowCursor;
            drawTimer.Tick += FollowCursor;
            drawTimer.Start();
        }

        void FollowCursor(object sender, EventArgs e)
        {
            if (band == null) return;
            Native.GetCursorPos(out var now);
            band.Span(drawStart, now);
        }

        void OnDrawEnded(Native.POINT end)
        {
            bool wasDrawing = drawTimer != null && drawTimer.IsEnabled;
            EndRubberBand();
            if (!wasDrawing) return;
            CreateFenceAt(new Native.RECT
            {
                Left = Math.Min(drawStart.X, end.X),
                Top = Math.Min(drawStart.Y, end.Y),
                Right = Math.Max(drawStart.X, end.X),
                Bottom = Math.Max(drawStart.Y, end.Y),
            });
        }

        void EndRubberBand()
        {
            drawTimer?.Stop();
            if (band != null)
            {
                band.Close();
                band = null;
            }
        }

        /// <summary>"New fence" from the tray: drag a rectangle on any monitor.</summary>
        public void StartDrawMode()
        {
            CancelDrawMode();
            if (QuickHidden) SetQuickHidden(false);
            if (Peeking) SetPeek(false);
            hooks.DrawModeActive = true;
            Native.GetCursorPos(out var cursor);
            foreach (var monitor in Native.Monitors())
            {
                var w = new DrawModeWindow();
                w.Drawn += rect =>
                {
                    CancelDrawMode();
                    CreateFenceAt(rect);
                };
                w.Cancelled += CancelDrawMode;
                w.Cover(monitor.Bounds);
                drawModes.Add(w);
                if (cursor.X >= monitor.Bounds.Left && cursor.X < monitor.Bounds.Right && cursor.Y >= monitor.Bounds.Top && cursor.Y < monitor.Bounds.Bottom)
                    w.TakeFocus();
            }
        }

        void CancelDrawMode()
        {
            if (drawModes.Count == 0) return;
            hooks.DrawModeActive = false;
            var open = drawModes.ToList();
            drawModes.Clear();
            foreach (var w in open) w.Close();
        }
    }

    /// <summary>Start DeskFence when Windows starts (HKCU Run key).</summary>
    internal static class AutoStart
    {
        const string Key = @"Software\Microsoft\Windows\CurrentVersion\Run";

        public static bool IsOn
        {
            get
            {
                using var key = Registry.CurrentUser.OpenSubKey(Key);
                return key?.GetValue("DeskFence") is string value && value.Contains(Environment.ProcessPath ?? "", StringComparison.OrdinalIgnoreCase);
            }
        }

        public static void Set(bool on)
        {
            using var key = Registry.CurrentUser.CreateSubKey(Key);
            if (on) key.SetValue("DeskFence", "\"" + Environment.ProcessPath + "\"");
            else key.DeleteValue("DeskFence", false);
        }
    }
}
