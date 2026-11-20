using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Threading;

namespace DeskFence
{
    /// <summary>Privacy, automation rules, Organize my Desktop, dialogs and Folder Portal browsing.</summary>
    internal sealed partial class DeskFenceApp
    {
        // ================= fences, for dialogs =================
        public int FenceCount => fences.Count;
        public string FirstFenceId => fences.FirstOrDefault()?.Id;
        public string FenceName(string id) => fences.FirstOrDefault(f => f.Id == id)?.Name;
        public IEnumerable<(string Value, string Label)> FenceChoices() => fences.Select(f => (f.Id, f.Name));

        public void ApplyStyleToAll(JsonObject style)
        {
            foreach (var fence in fences)
            {
                fence.Raw["style"] = JsonNode.Parse(style.ToJsonString());
                fence.Touch();
                if (windows.TryGetValue(fence.Id, out var w)) w.Refresh();
            }
            SaveSoon();
        }

        public void OpenCustomize(FenceWindow window) => ShowFenceDialog(window, new CustomizeWindow(this, window));
        public void OpenRules(FenceWindow window) => ShowFenceDialog(window, new FenceRulesWindow(this, window));

        void ShowFenceDialog(FenceWindow window, Window dialog)
        {
            window.DialogOpen = true; // privacy never masks a fence while you work on it
            window.Refresh();
            dialog.Closed += (_, __) =>
            {
                window.DialogOpen = false;
                window.Refresh();
            };
            dialog.Show();
            dialog.Activate();
        }

        public void OpenAutomation()
        {
            var dialog = new AutomationWindow(this);
            dialog.Show();
            dialog.Activate();
        }

        // ================= privacy for every fence =================
        public bool PrivacyAll => Setting("privacyMode", false);

        public void SetPrivacyAll(bool on)
        {
            settings["privacyMode"] = on;
            Storage.SaveSettings(settings);
            foreach (var w in windows.Values) w.Refresh();
        }

        // ================= Folder Portal: a sub-folder's items (not stored) =================
        public List<JsonObject> ListFolder(string folder)
        {
            var files = Listing(folder);
            if (files == null) return null;
            return SortInfos(files, "name").Select(f => new JsonObject
            {
                ["id"] = "browse-" + f.FullName,
                ["name"] = f.Name,
                ["path"] = f.FullName,
                ["type"] = f is DirectoryInfo ? "folder" : "file",
            }).ToList();
        }

        // ================= automation rules =================
        /// <summary>Rules not stored on one fence (settings.json "rules"); each names its target fence.</summary>
        public JsonArray GlobalRules
        {
            get
            {
                if (settings["rules"] is not JsonArray rules)
                {
                    rules = new JsonArray();
                    settings["rules"] = rules;
                }
                return rules;
            }
        }

        public void SaveGlobalRules()
        {
            Storage.SaveSettings(settings);
            RulesChanged();
        }

        /// <summary>Every rule: the fences' own rules first (each targets its fence), then the global ones.</summary>
        List<JsonObject> CollectRules()
        {
            var all = new List<JsonObject>();
            foreach (var fence in fences)
            {
                if (fence.Raw["rules"] is not JsonArray rules) continue;
                foreach (var rule in rules.OfType<JsonObject>())
                {
                    var copy = (JsonObject)JsonNode.Parse(rule.ToJsonString());
                    copy["targetFenceId"] = fence.Id;
                    all.Add(copy);
                }
            }
            all.AddRange(GlobalRules.OfType<JsonObject>().Select(r => (JsonObject)JsonNode.Parse(r.ToJsonString())));
            return all;
        }

        readonly Dictionary<string, FileSystemWatcher> ruleWatchers = new Dictionary<string, FileSystemWatcher>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, DispatcherTimer> pendingNew = new Dictionary<string, DispatcherTimer>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, DateTime> recentlyLeft = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Re-reads the rules and watches exactly the folders they name.</summary>
        public void RulesChanged()
        {
            var wanted = new HashSet<string>(CollectRules().Where(RuleEngine.Enabled).SelectMany(RuleEngine.WatchPaths).Where(Directory.Exists), StringComparer.OrdinalIgnoreCase);
            foreach (var folder in ruleWatchers.Keys.ToList())
            {
                if (wanted.Contains(folder)) continue;
                ruleWatchers[folder].Dispose();
                ruleWatchers.Remove(folder);
            }
            foreach (var folder in wanted)
            {
                if (ruleWatchers.ContainsKey(folder)) continue;
                try
                {
                    var watcher = new FileSystemWatcher(folder) { IncludeSubdirectories = false, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName, InternalBufferSize = 64 * 1024 };
                    string watched = folder;
                    watcher.Created += (_, e) => ui.BeginInvoke(new Action(() => NewItemSoon(e.FullPath, watched)));
                    watcher.Renamed += (_, e) => ui.BeginInvoke(new Action(() => NewItemSoon(e.FullPath, watched)));
                    watcher.EnableRaisingEvents = true;
                    ruleWatchers[folder] = watcher;
                }
                catch (Exception error)
                {
                    Log.Error("Watching " + folder + " for rules", error);
                }
            }
        }

        /// <summary>An item a fence just gave back (to the Desktop...): rules leave it alone for a while.</summary>
        public void NoteLeaving(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            recentlyLeft[Path.GetFileName(path.TrimEnd('\\', '/'))] = DateTime.Now;
        }

        bool JustLeftAFence(string path) =>
            recentlyLeft.TryGetValue(Path.GetFileName(path.TrimEnd('\\', '/')), out var when) && (DateTime.Now - when).TotalSeconds < 60;

        // a new file may still be downloading / copying: wait until it can be opened, then decide
        void NewItemSoon(string path, string folder, int attempt = 0)
        {
            if (pendingNew.TryGetValue(path, out var existing)) existing.Stop();
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(attempt == 0 ? 1500 : 2000) };
            pendingNew[path] = timer;
            timer.Tick += (_, __) =>
            {
                timer.Stop();
                pendingNew.Remove(path);
                if (!File.Exists(path) && !Directory.Exists(path)) return;
                if (File.Exists(path) && IsBusy(path))
                {
                    if (attempt < 30) NewItemSoon(path, folder, attempt + 1); // up to about a minute
                    return;
                }
                if (JustLeftAFence(path)) return;
                var rule = Decide(path, folder, CollectRules());
                if (rule != null) ApplyRule(rule, path);
            };
            timer.Start();
        }

        static bool IsBusy(string path)
        {
            try
            {
                using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.None);
                return false;
            }
            catch (IOException)
            {
                return true;
            }
            catch
            {
                return false;
            }
        }

        static readonly HashSet<string> NeverSorted = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "desktop.ini", "thumbs.db" };

        /// <summary>The first rule that watches this folder, matches the item and has a fence to go to.</summary>
        JsonObject Decide(string path, string folder, List<JsonObject> rules)
        {
            string name = Path.GetFileName(path.TrimEnd('\\', '/'));
            if (NeverSorted.Contains(name) || name.StartsWith(".")) return null;
            var info = ItemRow.FileInfoOf(path);
            if (info == null || (info.Attributes & FileAttributes.Hidden) != 0) return null;
            bool isDir = info is DirectoryInfo;
            long size = info is FileInfo fi ? fi.Length : 0;
            return rules.FirstOrDefault(r =>
                RuleEngine.WatchPaths(r).Any(p => FileOps.SamePath(p, folder)) &&
                fences.Any(f => f.Id == Theme.Str(r["targetFenceId"])) &&
                RuleEngine.Matches(r, path, isDir, size, info.LastWriteTime));
        }

        bool ApplyRule(JsonObject rule, string path, bool refresh = true)
        {
            var fence = fences.FirstOrDefault(f => f.Id == Theme.Str(rule["targetFenceId"]));
            if (fence == null) return false;
            string folder = FolderOf(fence);
            if (FileOps.SamePath(path, folder) || FileOps.IsInside(path, folder)) return false; // already there
            bool isDir = Directory.Exists(path);
            var result = FileOps.MoveInto(new[] { path }, folder, Theme.Str(rule["action"]) == "copy");
            if (result.Failed.Count > 0)
            {
                Log.Info($"Rule \"{Theme.Str(rule["name"])}\" could not handle {Path.GetFileName(path)}: {result.Failed[0].Error}");
                return false;
            }
            if (string.IsNullOrEmpty(fence.PortalPath))
            {
                foreach (var (_, to) in result.Moved)
                    if (!fence.AllItems().Any(i => string.Equals(Theme.Str(i["path"]), to, StringComparison.OrdinalIgnoreCase)))
                        fence.AddItem(to, isDir ? "folder" : "file");
            }
            if (refresh)
            {
                Reconcile(fence);
                SaveSoon();
                if (windows.TryGetValue(fence.Id, out var w)) w.Refresh();
            }
            return result.Moved.Count > 0;
        }

        // items already sitting in the watched folders that the given rules (or all) would take
        IEnumerable<(JsonObject Rule, string Path)> Existing(IEnumerable<JsonObject> only)
        {
            var rules = CollectRules();
            var onlyList = only?.Select(r => (Id: Theme.Str(r["id"]), Target: Theme.Str(r["targetFenceId"]))).ToList();
            var folders = new HashSet<string>((only ?? rules).SelectMany(RuleEngine.WatchPaths), StringComparer.OrdinalIgnoreCase);
            foreach (var folder in folders)
            {
                var files = Listing(folder);
                if (files == null) continue;
                foreach (var f in files)
                {
                    var rule = Decide(f.FullName, folder, rules);
                    if (rule == null) continue;
                    // a fence's own rule carries the fence's id once collected; match on the rule id
                    if (onlyList != null && !onlyList.Any(o => o.Id == Theme.Str(rule["id"]) && (string.IsNullOrEmpty(o.Target) || o.Target == Theme.Str(rule["targetFenceId"])))) continue;
                    yield return (rule, f.FullName);
                }
            }
        }

        public int CountExisting(IEnumerable<JsonObject> only) => Existing(only).Count();

        public int SortExisting(IEnumerable<JsonObject> only)
        {
            int moved = 0;
            var touched = new HashSet<string>();
            foreach (var (rule, path) in Existing(only).ToList())
            {
                if (ApplyRule(rule, path, refresh: false))
                {
                    moved++;
                    touched.Add(Theme.Str(rule["targetFenceId"]));
                }
            }
            foreach (var id in touched)
            {
                var fence = fences.FirstOrDefault(f => f.Id == id);
                if (fence == null) continue;
                Reconcile(fence);
                if (windows.TryGetValue(id, out var w)) w.Refresh();
            }
            if (moved > 0) SaveSoon();
            return moved;
        }

        // ================= Organize my Desktop =================
        /// <summary>One fence per kind found on the Desktop (Folders, Apps, Images...), each with a rule that keeps sorting.</summary>
        public void OrganizeDesktop()
        {
            string desktop = DesktopPath();
            var files = Listing(desktop) ?? new List<FileSystemInfo>();
            var counts = new Dictionary<string, int>();
            foreach (var f in files)
            {
                var kind = QuickRule.KindOf(f.FullName, f is DirectoryInfo);
                if (kind != null) counts[kind.Key] = counts.TryGetValue(kind.Key, out int n) ? n + 1 : 1;
            }
            var groups = QuickRule.All.Where(q => counts.ContainsKey(q.Key)).ToList();
            if (groups.Count == 0)
            {
                MessageBox.Show("Nothing to organize: no files or folders on the Desktop.", "DeskFence");
                return;
            }
            FenceData ExistingFor(QuickRule q) => fences.FirstOrDefault(f => (f.Raw["rules"] as JsonArray)?.OfType<JsonObject>().Any(r => Theme.Str(r["preset"]) == q.Key) == true);
            string lines = string.Join("\n", groups.Select(g => $"•  {g.Label}: {counts[g.Key]}" + (ExistingFor(g) != null ? " (existing fence)" : "")));
            int total = groups.Sum(g => counts[g.Key]);
            if (MessageBox.Show($"Organize your Desktop into fences?\n\n{lines}\n\n{total} item(s) will move from the Desktop into the fences (their files go to Documents\\DeskFence). New Desktop items of these kinds will be sorted automatically.\nDragging an item out of a fence puts it back.",
                    "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;

            // new fences in a column on the right of the main monitor
            var monitor = Native.Monitors().FirstOrDefault(m => m.Primary) ?? Native.Monitors().First();
            double workW = (monitor.Work.Right - monitor.Work.Left) / monitor.Scale;
            double workH = (monitor.Work.Bottom - monitor.Work.Top) / monitor.Scale;
            double width = 292, x = workW - width - 16, y = 16;
            var rules = new List<JsonObject>();
            foreach (var g in groups)
            {
                var fence = ExistingFor(g);
                if (fence == null)
                {
                    int rows = Math.Min(4, Math.Max(1, (int)Math.Ceiling(counts[g.Key] / 5.0)));
                    double height = 34 + rows * 64 + 8;
                    if (y + height > workH - 16) { y = 16; x -= width + 12; }
                    fence = FenceData.Create(g.Label, Math.Max(0, x), y, width, height, monitor.Device);
                    fence.Raw["rules"] = new JsonArray();
                    fences.Add(fence);
                    OpenWindow(fence);
                    y += height + 12;
                }
                var existingRule = (fence.Raw["rules"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(r => Theme.Str(r["preset"]) == g.Key);
                if (existingRule == null)
                {
                    existingRule = g.MakeRule(fence.Id, desktop);
                    ((JsonArray)fence.Raw["rules"]).Add(existingRule);
                    fence.Touch();
                }
                var collected = (JsonObject)JsonNode.Parse(existingRule.ToJsonString());
                collected["targetFenceId"] = fence.Id;
                rules.Add(collected);
            }
            SaveSoon();
            RulesChanged();
            int moved = SortExisting(rules);
            Notice($"{moved} item(s) moved off the Desktop into fences.");
        }
    }
}
