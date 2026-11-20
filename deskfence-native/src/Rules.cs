using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace DeskFence
{
    /// <summary>
    /// Automation rules, in the same JSON shape the Electron version saved them:
    /// { id, name, enabled, conditions: [{ type, operator, value }], action: "move"|"copy",
    ///   targetFenceId, watchPaths: [...], preset? }
    /// All conditions must match. Rules stored on a fence always target that fence.
    /// </summary>
    internal static class RuleEngine
    {
        public static readonly string[] ConditionTypes = { "extension", "name", "size", "date", "path", "kind" };

        public static string[] OperatorsFor(string type) => type switch
        {
            "extension" => new[] { "equals", "contains" },
            "name" => new[] { "equals", "contains", "startsWith", "endsWith", "matches" },
            "size" => new[] { "equals", "greaterThan", "lessThan" },
            "date" => new[] { "equals", "greaterThan", "lessThan" },
            "path" => new[] { "equals", "contains", "startsWith" },
            "kind" => new[] { "equals" },
            _ => new[] { "equals" },
        };

        public static string Label(string word) => word switch
        {
            "extension" => "File extension",
            "name" => "File name",
            "size" => "File size",
            "date" => "Date modified (days)",
            "path" => "Source path",
            "kind" => "Kind (file / folder)",
            "equals" => "is",
            "contains" => "contains",
            "startsWith" => "starts with",
            "endsWith" => "ends with",
            "matches" => "matches (regex)",
            "greaterThan" => "more than",
            "lessThan" => "less than",
            _ => word,
        };

        static string Str(JsonNode n)
        {
            if (n is JsonValue v)
            {
                if (v.TryGetValue(out string s)) return s;
                if (v.TryGetValue(out double d)) return d.ToString(CultureInfo.InvariantCulture);
            }
            return "";
        }

        public static bool Enabled(JsonObject rule) => !(rule["enabled"] is JsonValue v && v.TryGetValue(out bool b) && !b);

        public static IEnumerable<string> WatchPaths(JsonObject rule) =>
            (rule["watchPaths"] as JsonArray ?? new JsonArray()).Select(Str).Where(p => p.Length > 0);

        /// <summary>True when every condition of the (enabled) rule matches the file.</summary>
        public static bool Matches(JsonObject rule, string path, bool isDirectory, long size, DateTime modified)
        {
            if (!Enabled(rule) || rule["conditions"] is not JsonArray conditions || conditions.Count == 0) return false;
            string name = Path.GetFileName(path.TrimEnd('\\', '/'));
            return conditions.OfType<JsonObject>().All(c => MatchesCondition(c, path, name, isDirectory, size, modified));
        }

        static bool MatchesCondition(JsonObject c, string path, string name, bool isDirectory, long size, DateTime modified)
        {
            string type = Str(c["type"]);
            string op = Str(c["operator"]);
            string value = Str(c["value"]);
            switch (type)
            {
                case "kind":
                    return value.Trim().ToLowerInvariant() == (isDirectory ? "folder" : "file");

                case "extension":
                {
                    if (isDirectory) return false; // "Projects.v2" is a folder, not a ".v2" file
                    int dot = name.LastIndexOf('.');
                    string ext = dot > 0 ? name.Substring(dot + 1).ToLowerInvariant() : "";
                    var wanted = value.Split(new[] { ' ', ',', ';' }, StringSplitOptions.RemoveEmptyEntries)
                        .Select(e => e.Trim().TrimStart('.').ToLowerInvariant()).Where(e => e.Length > 0).ToList();
                    if (wanted.Count == 0) return false;
                    return op == "contains" ? wanted.Any(w => ext.Contains(w)) : wanted.Contains(ext);
                }

                case "name":
                {
                    string n = name.ToLowerInvariant(), v = value.ToLowerInvariant();
                    switch (op)
                    {
                        case "equals": return n == v;
                        case "contains": return n.Contains(v);
                        case "startsWith": return n.StartsWith(v);
                        case "endsWith": return n.EndsWith(v);
                        case "matches":
                            try { return Regex.IsMatch(name, value, RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(100)); }
                            catch { return false; }
                        default: return false;
                    }
                }

                case "size":
                {
                    if (isDirectory) return false;
                    long? target = ParseSize(value);
                    if (target == null) return false;
                    return op switch { "equals" => size == target, "greaterThan" => size > target, "lessThan" => size < target, _ => false };
                }

                case "date":
                {
                    if (op == "equals")
                        return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var day) && modified.Date == day.Date;
                    if (!double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out double days) || days < 0) return false;
                    double age = (DateTime.Now - modified).TotalDays;
                    return op == "greaterThan" ? age > days : op == "lessThan" && age < days;
                }

                case "path":
                {
                    string p = path.ToLowerInvariant(), v = value.ToLowerInvariant();
                    return op switch { "equals" => p == v, "contains" => p.Contains(v), "startsWith" => p.StartsWith(v), _ => false };
                }
            }
            return false;
        }

        /// <summary>"500", "10KB", "2.5 MB", "1gb" -> bytes.</summary>
        public static long? ParseSize(string text)
        {
            var m = Regex.Match(text.Trim(), @"^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$", RegexOptions.IgnoreCase);
            if (!m.Success) return null;
            double n = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
            double unit = (m.Groups[2].Value.ToLowerInvariant()) switch { "kb" => 1024, "mb" => 1024.0 * 1024, "gb" => 1024.0 * 1024 * 1024, "tb" => 1024.0 * 1024 * 1024 * 1024, _ => 1 };
            return (long)Math.Round(n * unit);
        }

        public static string Describe(JsonObject rule)
        {
            var parts = (rule["conditions"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
                .Select(c => Label(Str(c["type"])).ToLowerInvariant() + " " + Label(Str(c["operator"])) + " \"" + Str(c["value"]) + "\"");
            return (Str(rule["action"]) == "copy" ? "Copy" : "Move") + " items where " + string.Join(" and ", parts);
        }

        public static JsonObject NewRule(string name, IEnumerable<JsonObject> conditions, string action, string targetFenceId, IEnumerable<string> watchPaths, string preset = null)
        {
            var rule = new JsonObject
            {
                ["id"] = FenceData.NewId("rule"),
                ["name"] = name,
                ["enabled"] = true,
                ["conditions"] = new JsonArray(conditions.Select(c => (JsonNode)JsonNode.Parse(c.ToJsonString())).ToArray()),
                ["action"] = action,
                ["targetFenceId"] = targetFenceId ?? "",
                ["watchPaths"] = new JsonArray(watchPaths.Select(p => (JsonNode)JsonValue.Create(p)).ToArray()),
            };
            if (preset != null) rule["preset"] = preset;
            return rule;
        }

        public static JsonObject Condition(string type, string op, string value) =>
            new JsonObject { ["type"] = type, ["operator"] = op, ["value"] = value };
    }

    /// <summary>One-click rules: "everything of this kind that lands on the Desktop goes into this fence".</summary>
    internal sealed class QuickRule
    {
        public string Key, Label, Glyph;
        public JsonObject[] Conditions;

        static JsonObject Ext(string list) => RuleEngine.Condition("extension", "equals", list);

        // order matters: an item goes to the FIRST kind it matches
        public static readonly QuickRule[] All =
        {
            new QuickRule { Key = "folders", Label = "Folders", Glyph = "", Conditions = new[] { RuleEngine.Condition("kind", "equals", "folder") } },
            new QuickRule { Key = "apps", Label = "Apps", Glyph = "", Conditions = new[] { Ext("lnk url exe appref-ms") } },
            new QuickRule { Key = "images", Label = "Images", Glyph = "", Conditions = new[] { Ext("jpg jpeg png gif bmp webp heic heif svg tif tiff ico raw") } },
            new QuickRule { Key = "documents", Label = "Documents", Glyph = "", Conditions = new[] { Ext("pdf doc docx xls xlsx xlsm ppt pptx txt rtf odt ods odp csv md epub") } },
            new QuickRule { Key = "videos", Label = "Videos", Glyph = "", Conditions = new[] { Ext("mp4 mkv avi mov wmv webm m4v flv") } },
            new QuickRule { Key = "music", Label = "Music", Glyph = "", Conditions = new[] { Ext("mp3 wav flac aac ogg m4a wma opus") } },
            new QuickRule { Key = "archives", Label = "Archives", Glyph = "", Conditions = new[] { Ext("zip rar 7z tar gz bz2 xz iso") } },
            new QuickRule { Key = "installers", Label = "Installers", Glyph = "", Conditions = new[] { Ext("msi msix appx") } },
        };

        public JsonObject MakeRule(string targetFenceId, string watchFolder) =>
            RuleEngine.NewRule(Label + " from the Desktop", Conditions, "move", targetFenceId, new[] { watchFolder }, Key);

        /// <summary>The first kind an item belongs to, or null.</summary>
        public static QuickRule KindOf(string path, bool isDirectory)
        {
            var probe = new JsonObject();
            foreach (var quick in All)
            {
                probe = RuleEngine.NewRule(quick.Label, quick.Conditions, "move", "", Array.Empty<string>());
                if (RuleEngine.Matches(probe, path, isDirectory, 0, DateTime.Now)) return quick;
            }
            return null;
        }
    }
}
