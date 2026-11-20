using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DeskFence
{
    /// <summary>
    /// fences.json and settings.json in %APPDATA%\deskfence: the same files the earlier (Electron)
    /// DeskFence used, so existing fences carry over. Fields this version does not use yet (rules,
    /// privacy, view...) are kept untouched, because each fence stays a JSON object we only edit.
    /// </summary>
    internal static class Storage
    {
        public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "deskfence");
        static string FencesFile => Path.Combine(Dir, "fences.json");
        static string SettingsFile => Path.Combine(Dir, "settings.json");
        static readonly JsonSerializerOptions Pretty = new JsonSerializerOptions { WriteIndented = true };

        public static List<FenceData> LoadFences()
        {
            var node = ReadJson(FencesFile) ?? ReadJson(FencesFile + ".bak");
            var list = new List<FenceData>();
            if (node is JsonArray array)
            {
                foreach (var item in array)
                {
                    if (item is JsonObject obj && obj["id"] is JsonValue)
                    {
                        // detach from the parsed array so it can live on its own
                        list.Add(new FenceData((JsonObject)JsonNode.Parse(obj.ToJsonString())));
                    }
                }
            }
            return list;
        }

        public static void SaveFences(IEnumerable<FenceData> fences)
        {
            var array = new JsonArray();
            foreach (var f in fences) array.Add(JsonNode.Parse(f.Raw.ToJsonString()));
            WriteJson(FencesFile, array, keepBackup: true);
        }

        public static JsonObject LoadSettings()
        {
            return ReadJson(SettingsFile) as JsonObject ?? new JsonObject();
        }

        public static void SaveSettings(JsonObject settings) => WriteJson(SettingsFile, settings, keepBackup: false);

        /// <summary>widgets.json: the clock and to-do widgets (positions, options, tasks).</summary>
        public static JsonObject LoadWidgets() => ReadJson(Path.Combine(Dir, "widgets.json")) as JsonObject ?? new JsonObject();

        public static void SaveWidgets(JsonObject widgets) => WriteJson(Path.Combine(Dir, "widgets.json"), widgets, keepBackup: true);

        static JsonNode ReadJson(string file)
        {
            try
            {
                if (!File.Exists(file)) return null;
                return JsonNode.Parse(File.ReadAllText(file));
            }
            catch (Exception error)
            {
                Log.Error("Could not read " + file, error);
                try { File.Copy(file, file + ".corrupt-" + DateTime.Now.Ticks); } catch { /* best effort */ }
                return null;
            }
        }

        // Crash-safe: write a temp file, then swap it in (keeping the previous version as .bak)
        static void WriteJson(string file, JsonNode node, bool keepBackup)
        {
            Directory.CreateDirectory(Dir);
            string tmp = file + ".tmp";
            File.WriteAllText(tmp, node.ToJsonString(Pretty));
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    if (keepBackup && File.Exists(file) && new FileInfo(file).Length > 2) File.Copy(file, file + ".bak", true);
                    File.Move(tmp, file, true);
                    return;
                }
                catch (IOException) when (attempt < 5)
                {
                    System.Threading.Thread.Sleep(50 * (attempt + 1)); // antivirus / indexer holding the file
                }
                catch (UnauthorizedAccessException) when (attempt < 5)
                {
                    System.Threading.Thread.Sleep(50 * (attempt + 1));
                }
            }
        }
    }

    /// <summary>One fence: a thin typed view over its JSON object.</summary>
    internal sealed class FenceData
    {
        public JsonObject Raw { get; }

        public FenceData(JsonObject raw)
        {
            Raw = raw;
            if (Raw["items"] is not JsonArray) Raw["items"] = new JsonArray();
            if (Raw["style"] is not JsonObject) Raw["style"] = Theme.DefaultStyle();
            if (Raw["position"] is not JsonObject) Raw["position"] = new JsonObject { ["x"] = 100, ["y"] = 100 };
            if (Raw["size"] is not JsonObject) Raw["size"] = new JsonObject { ["width"] = 300, ["height"] = 220 };
        }

        public static FenceData Create(string name, double x, double y, double width, double height, string device)
        {
            var raw = new JsonObject
            {
                ["id"] = "fence-" + DateTimeOffset.Now.ToUnixTimeMilliseconds() + "-" + Guid.NewGuid().ToString("N").Substring(0, 6),
                ["name"] = name,
                ["position"] = new JsonObject { ["x"] = Math.Round(x), ["y"] = Math.Round(y) },
                ["size"] = new JsonObject { ["width"] = Math.Round(width), ["height"] = Math.Round(height) },
                ["items"] = new JsonArray(),
                ["style"] = Theme.DefaultStyle(),
                ["gridSize"] = 80,
            };
            if (!string.IsNullOrEmpty(device)) raw["screenDevice"] = device;
            var fence = new FenceData(raw);
            fence.Touch();
            return fence;
        }

        public string Id => Str("id");
        public string Name { get => Str("name") ?? "Fence"; set { Raw["name"] = value; Touch(); } }
        public string PortalPath { get => Str("portalPath"); set { Set("portalPath", value); Touch(); } }
        public string StoragePath { get => Str("storagePath"); set { Set("storagePath", value); Touch(); } }
        /// <summary>Monitor (device name) the position is relative to; missing for fences from the Electron version.</summary>
        public string ScreenDevice { get => Str("screenDevice"); set { Set("screenDevice", value); Touch(); } }

        public double X => Num(Raw["position"]?["x"], 100);
        public double Y => Num(Raw["position"]?["y"], 100);
        public double Width => Math.Max(160, Num(Raw["size"]?["width"], 300));
        public double Height => Math.Max(60, Num(Raw["size"]?["height"], 220));

        public void SetBounds(double x, double y, double width, double height, string device)
        {
            Raw["position"] = new JsonObject { ["x"] = Math.Round(x), ["y"] = Math.Round(y) };
            Raw["size"] = new JsonObject { ["width"] = Math.Round(width), ["height"] = Math.Round(height) };
            Set("screenDevice", device);
            Touch();
        }

        public bool Collapsed { get => Bool("collapsed"); set { Raw["collapsed"] = value; Touch(); } }
        public bool AutoRollup { get => Bool("autoRollup"); set { Raw["autoRollup"] = value; Touch(); } }
        public bool IsLocked { get => Bool("isLocked"); set { Raw["isLocked"] = value; Touch(); } }

        public JsonObject Style => Raw["style"] as JsonObject;
        public JsonArray Items => Raw["items"] as JsonArray;
        public JsonArray Tabs => Raw["tabs"] as JsonArray;
        public bool HasTabs => Tabs != null && Tabs.Count > 1;

        public string ActiveTabId
        {
            get
            {
                var tabs = Tabs;
                if (tabs == null || tabs.Count == 0) return null;
                string id = Str("activeTabId");
                return tabs.Any(t => Theme.Str(t?["id"]) == id) ? id : Theme.Str(tabs[0]?["id"]);
            }
        }

        /// <summary>Every item across all tabs (the active tab's items live in "items").</summary>
        public IEnumerable<JsonObject> AllItems()
        {
            foreach (var item in Items.OfType<JsonObject>()) yield return item;
            if (Tabs == null) yield break;
            string active = ActiveTabId;
            foreach (var tab in Tabs.OfType<JsonObject>())
            {
                if (Theme.Str(tab["id"]) == active) continue;
                if (tab["items"] is JsonArray items)
                    foreach (var item in items.OfType<JsonObject>()) yield return item;
            }
        }

        public void SwitchTab(string tabId)
        {
            if (Tabs == null || tabId == ActiveTabId) return;
            var target = Tabs.OfType<JsonObject>().FirstOrDefault(t => Theme.Str(t["id"]) == tabId);
            if (target == null) return;
            SnapshotActiveTab();
            Raw["items"] = JsonNode.Parse((target["items"] ?? new JsonArray()).ToJsonString());
            Raw["activeTabId"] = tabId;
            Touch();
        }

        public void AddTab()
        {
            if (Tabs == null || Tabs.Count == 0)
            {
                Raw["tabs"] = new JsonArray { new JsonObject { ["id"] = NewId("tab"), ["name"] = "Tab 1", ["items"] = JsonNode.Parse(Items.ToJsonString()) } };
            }
            else
            {
                SnapshotActiveTab();
            }
            var created = new JsonObject { ["id"] = NewId("tab"), ["name"] = "Tab " + (Tabs.Count + 1), ["items"] = new JsonArray() };
            Tabs.Add(created);
            Raw["activeTabId"] = Theme.Str(created["id"]);
            Raw["items"] = new JsonArray();
            Touch();
        }

        public void RenameTab(string tabId, string name)
        {
            var tab = Tabs?.OfType<JsonObject>().FirstOrDefault(t => Theme.Str(t["id"]) == tabId);
            if (tab == null || string.IsNullOrWhiteSpace(name)) return;
            tab["name"] = name.Trim().Length > 40 ? name.Trim().Substring(0, 40) : name.Trim();
            Touch();
        }

        /// <summary>Closes a tab; its items move to the neighbouring tab (nothing is lost).</summary>
        public void RemoveTab(string tabId)
        {
            if (Tabs == null || Tabs.Count < 2) return;
            SnapshotActiveTab();
            var tabs = Tabs.OfType<JsonObject>().ToList();
            int index = tabs.FindIndex(t => Theme.Str(t["id"]) == tabId);
            if (index < 0) return;
            var removed = tabs[index];
            var neighbour = tabs[index > 0 ? index - 1 : 1];
            var into = neighbour["items"] as JsonArray ?? new JsonArray();
            foreach (var item in (removed["items"] as JsonArray ?? new JsonArray()).ToList())
                into.Add(JsonNode.Parse(item.ToJsonString()));
            neighbour["items"] = JsonNode.Parse(into.ToJsonString());
            Tabs.Remove(removed);
            string nextActive = ActiveTabIdRaw() == tabId ? Theme.Str(neighbour["id"]) : ActiveTabIdRaw();
            var active = Tabs.OfType<JsonObject>().First(t => Theme.Str(t["id"]) == nextActive);
            Raw["items"] = JsonNode.Parse((active["items"] ?? new JsonArray()).ToJsonString());
            if (Tabs.Count == 1)
            {
                Raw.Remove("tabs");
                Raw.Remove("activeTabId");
            }
            else
            {
                Raw["activeTabId"] = nextActive;
            }
            Touch();
        }

        string ActiveTabIdRaw() => ActiveTabId;

        void SnapshotActiveTab()
        {
            string active = ActiveTabId;
            var tab = Tabs?.OfType<JsonObject>().FirstOrDefault(t => Theme.Str(t["id"]) == active);
            if (tab != null) tab["items"] = JsonNode.Parse(Items.ToJsonString());
        }

        public JsonObject AddItem(string path, string type)
        {
            var item = new JsonObject
            {
                ["id"] = NewId("item"),
                ["name"] = Path.GetFileName(path.TrimEnd('\\', '/')),
                ["path"] = path,
                ["type"] = type,
                ["position"] = new JsonObject { ["x"] = 0, ["y"] = 0 },
            };
            Items.Add(item);
            Touch();
            return item;
        }

        /// <summary>Removes the item from whichever tab holds it.</summary>
        public bool RemoveItem(string itemId)
        {
            bool removed = RemoveFrom(Items, itemId);
            if (Tabs != null)
                foreach (var tab in Tabs.OfType<JsonObject>())
                    if (tab["items"] is JsonArray items) removed |= RemoveFrom(items, itemId);
            if (removed) Touch();
            return removed;
        }

        static bool RemoveFrom(JsonArray array, string itemId)
        {
            var found = array.OfType<JsonObject>().FirstOrDefault(i => Theme.Str(i["id"]) == itemId);
            if (found == null) return false;
            array.Remove(found);
            return true;
        }

        public void ReplaceItems(JsonArray items)
        {
            Raw["items"] = items;
            Touch();
        }

        /// <summary>Stamps the change time (the merge rule of the shared fences.json: newer wins).</summary>
        public void Touch() => Raw["updatedAt"] = DateTimeOffset.Now.ToUnixTimeMilliseconds();

        public static string NewId(string prefix) => prefix + "-" + DateTimeOffset.Now.ToUnixTimeMilliseconds() + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);

        string Str(string key) => Raw[key] is JsonValue v && v.TryGetValue(out string s) ? s : null;
        bool Bool(string key) => Raw[key] is JsonValue v && v.TryGetValue(out bool b) && b;

        void Set(string key, string value)
        {
            if (string.IsNullOrEmpty(value)) Raw.Remove(key);
            else Raw[key] = value;
        }

        public static double Num(JsonNode node, double fallback)
        {
            if (node is JsonValue v)
            {
                if (v.TryGetValue(out double d) && !double.IsNaN(d)) return d;
                if (v.TryGetValue(out long l)) return l;
                if (v.TryGetValue(out int i)) return i;
            }
            return fallback;
        }
    }
}
