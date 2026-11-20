using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;

namespace DeskFence
{
    /// <summary>Minimal 5-field cron (minute hour day-of-month month day-of-week), the format the Electron version saved.</summary>
    internal static class Cron
    {
        sealed class Parsed
        {
            public HashSet<int> Minute, Hour, Dom, Month, Dow;
            public bool DomAny, DowAny;
        }

        static HashSet<int> Field(string field, int min, int max)
        {
            var values = new HashSet<int>();
            foreach (var part in field.Split(','))
            {
                var bits = part.Split('/');
                int step = 1;
                if (bits.Length > 1 && (!int.TryParse(bits[1], out step) || step < 1)) return null;
                int start, end;
                if (bits[0] == "*") { start = min; end = max; }
                else if (bits[0].Contains('-'))
                {
                    var r = bits[0].Split('-');
                    if (!int.TryParse(r[0], out start) || !int.TryParse(r[1], out end)) return null;
                }
                else
                {
                    if (!int.TryParse(bits[0], out start)) return null;
                    end = bits.Length > 1 ? max : start;
                }
                if (start < min || end > max || start > end) return null;
                for (int v = start; v <= end; v += step) values.Add(v);
            }
            return values;
        }

        static Parsed Parse(string expression)
        {
            var p = (expression ?? "").Trim().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            if (p.Length != 5) return null;
            var parsed = new Parsed
            {
                Minute = Field(p[0], 0, 59), Hour = Field(p[1], 0, 23), Dom = Field(p[2], 1, 31), Month = Field(p[3], 1, 12),
                Dow = Field(p[4], 0, 7)?.Select(d => d == 7 ? 0 : d).ToHashSet(), DomAny = p[2] == "*", DowAny = p[4] == "*",
            };
            return parsed.Minute == null || parsed.Hour == null || parsed.Dom == null || parsed.Month == null || parsed.Dow == null ? null : parsed;
        }

        public static bool IsValid(string expression) => Parse(expression) != null;

        /// <summary>The first minute strictly after `from` that matches, or null.</summary>
        public static DateTime? Next(string expression, DateTime from)
        {
            var c = Parse(expression);
            if (c == null) return null;
            var d = new DateTime(from.Year, from.Month, from.Day, from.Hour, from.Minute, 0).AddMinutes(1);
            for (int i = 0; i < 366 * 24 * 60; i++)
            {
                bool dom = c.Dom.Contains(d.Day), dow = c.Dow.Contains((int)d.DayOfWeek);
                bool day = !c.DomAny && !c.DowAny ? dom || dow : dom && dow;
                if (c.Minute.Contains(d.Minute) && c.Hour.Contains(d.Hour) && c.Month.Contains(d.Month) && day) return d;
                d = d.AddMinutes(1);
            }
            return null;
        }

        /// <summary>Human words for the schedules the editor makes (anything else: the expression).</summary>
        public static string Describe(string expression)
        {
            var p = (expression ?? "").Split(' ');
            if (p.Length != 5 || !int.TryParse(p[0], out int m) || !int.TryParse(p[1], out int h)) return expression;
            string at = new DateTime(2000, 1, 1, h, m, 0).ToString("t", CultureInfo.CurrentCulture);
            if (p[2] == "*" && p[3] == "*" && p[4] == "*") return "Every day at " + at;
            if (p[2] == "*" && p[3] == "*" && int.TryParse(p[4], out int dow)) return "Every " + CultureInfo.CurrentCulture.DateTimeFormat.GetDayName((DayOfWeek)(dow % 7)) + " at " + at;
            if (p[3] == "*" && p[4] == "*" && int.TryParse(p[2], out int dom)) return "On day " + dom + " of every month at " + at;
            return expression;
        }
    }

    /// <summary>
    /// Scheduled cleanups (settings.json "scheduledTasks"): move items older than N days from folders into
    /// an archive folder, or send them to the Recycle Bin. Safe by design: system folders and whole drives
    /// are refused, at least 1 day old, deletes go to the Recycle Bin, the archive folder itself is skipped.
    /// </summary>
    internal static class Cleanup
    {
        public sealed class Result
        {
            public readonly List<string> Matched = new List<string>();
            public int Processed;
            public readonly List<(string Path, string Error)> Failed = new List<(string, string)>();
        }

        static readonly string[] Protected =
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        };

        public static bool IsProtected(string folder)
        {
            try
            {
                string full = Path.GetFullPath(folder).TrimEnd('\\');
                if (Path.GetPathRoot(full)?.TrimEnd('\\') == full) return true; // a whole drive
                return Protected.Where(p => !string.IsNullOrEmpty(p)).Any(p => FileOps.SamePath(full, p) || FileOps.IsInside(full, p));
            }
            catch
            {
                return true;
            }
        }

        static IEnumerable<string> Strings(JsonNode node) => (node as JsonArray ?? new JsonArray()).Select(n => Theme.Str(n)).Where(s => !string.IsNullOrWhiteSpace(s));

        public static JsonObject Config(JsonObject task) => task["config"] as JsonObject ?? new JsonObject();
        public static IEnumerable<string> Folders(JsonObject task) => Strings(Config(task)["targetPaths"]);
        public static int OlderThan(JsonObject task) => (int)Math.Max(0, FenceData.Num(Config(task)["olderThan"], 0));
        public static string Action(JsonObject task) => Theme.Str(Config(task)["action"]) == "delete" ? "delete" : "archive";
        public static string Destination(JsonObject task) => Theme.Str(Config(task)["destination"]);
        public static List<string> Extensions(JsonObject task) => Strings(Config(task)["extensions"]).Select(e => e.Trim().TrimStart('.').ToLowerInvariant()).ToList();
        public static bool Enabled(JsonObject task) => !(task["enabled"] is JsonValue v && v.TryGetValue(out bool b) && !b);

        /// <summary>What the task matches now; with `dryRun: false` also does it.</summary>
        public static Result Run(JsonObject task, bool dryRun)
        {
            var result = new Result();
            int days = OlderThan(task);
            if (!dryRun && days < 1)
            {
                result.Failed.Add(("", "Refused: \"older than\" must be at least 1 day"));
                return result;
            }
            var cutoff = DateTime.Now.AddDays(-days);
            var extensions = Extensions(task);
            string destination = Destination(task);
            bool delete = Action(task) == "delete";

            foreach (var folder in Folders(task))
            {
                if (IsProtected(folder))
                {
                    result.Failed.Add((folder, "Protected system folder or whole drive, skipped"));
                    continue;
                }
                IEnumerable<FileSystemInfo> entries;
                try
                {
                    entries = new DirectoryInfo(folder).EnumerateFileSystemInfos().ToList();
                }
                catch (Exception error)
                {
                    result.Failed.Add((folder, FileOps.Friendly(error, true)));
                    continue;
                }
                foreach (var e in entries)
                {
                    if (e.Name.Equals("desktop.ini", StringComparison.OrdinalIgnoreCase) || (e.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue;
                    if (e.LastWriteTime >= cutoff) continue; // too new
                    if (extensions.Count > 0 && (e is DirectoryInfo || !extensions.Contains(e.Extension.TrimStart('.').ToLowerInvariant()))) continue;
                    // never the archive folder itself (or a folder that contains it)
                    if (!string.IsNullOrEmpty(destination) && (FileOps.SamePath(e.FullName, destination) || FileOps.IsInside(destination, e.FullName))) continue;
                    result.Matched.Add(e.FullName);
                }
            }
            if (dryRun) return result;

            foreach (var path in result.Matched)
            {
                if (delete)
                {
                    if (Native.SendToRecycleBin(path)) result.Processed++;
                    else result.Failed.Add((path, "Could not send it to the Recycle Bin (in use?)"));
                }
                else
                {
                    if (string.IsNullOrEmpty(destination)) { result.Failed.Add((path, "No archive folder set")); continue; }
                    var moved = FileOps.MoveInto(new[] { path }, destination);
                    result.Processed += moved.Moved.Count;
                    result.Failed.AddRange(moved.Failed);
                }
            }
            return result;
        }

        public static JsonObject NewTask(string name, string schedule, IEnumerable<string> folders, int olderThan, string action, string destination, IEnumerable<string> extensions)
        {
            var task = new JsonObject
            {
                ["id"] = FenceData.NewId("task"),
                ["name"] = name,
                ["type"] = "cleanup",
                ["enabled"] = true,
                ["schedule"] = schedule,
                ["config"] = new JsonObject
                {
                    ["targetPaths"] = new JsonArray(folders.Select(f => (JsonNode)JsonValue.Create(f)).ToArray()),
                    ["olderThan"] = olderThan,
                    ["action"] = action,
                    ["destination"] = destination ?? "",
                    ["extensions"] = new JsonArray(extensions.Select(e => (JsonNode)JsonValue.Create(e)).ToArray()),
                },
            };
            SetNextRun(task, DateTime.Now);
            return task;
        }

        public static void SetNextRun(JsonObject task, DateTime from)
        {
            var next = Cron.Next(Theme.Str(task["schedule"]), from);
            if (next.HasValue) task["nextRun"] = new DateTimeOffset(next.Value).ToUnixTimeMilliseconds();
            else task.Remove("nextRun");
        }

        /// <summary>Due when its next run has passed (also catches up once after the PC was off).</summary>
        public static bool IsDue(JsonObject task, DateTime now)
        {
            if (!Enabled(task)) return false;
            double next = FenceData.Num(task["nextRun"], double.NaN);
            if (double.IsNaN(next))
            {
                SetNextRun(task, now);
                return false;
            }
            return new DateTimeOffset(now).ToUnixTimeMilliseconds() >= next;
        }

        static string Join(string a, params string[] parts) => string.IsNullOrEmpty(a) ? "" : Path.Combine(new[] { a }.Concat(parts).ToArray());

        /// <summary>Ready-made tasks: only your own Desktop / Downloads, archive by default, older items only.</summary>
        public static List<(string Description, JsonObject Task)> Presets()
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            string downloads = Join(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            var list = new List<(string, JsonObject)>
            {
                ("Every Sunday 03:00: Desktop items untouched for 14+ days move to Documents\\DeskFence Archive\\Desktop",
                    NewTask("Weekly Desktop tidy-up", "0 3 * * 0", new[] { desktop }, 14, "archive", Join(documents, "DeskFence Archive", "Desktop"), Array.Empty<string>())),
                ("Day 1 of every month 02:00: Downloads older than 30 days move to Documents\\DeskFence Archive\\Downloads",
                    NewTask("Monthly Downloads archive", "0 2 1 * *", new[] { downloads }, 30, "archive", Join(documents, "DeskFence Archive", "Downloads"), Array.Empty<string>())),
                ("Every Sunday 02:00: installers (.exe .msi) in Downloads older than 14 days go to the Recycle Bin",
                    NewTask("Old installers to Recycle Bin", "0 2 * * 0", new[] { downloads }, 14, "delete", "", new[] { "exe", "msi" })),
                ("Every Sunday 02:00: anything in Downloads older than 90 days goes to the Recycle Bin (restorable)",
                    NewTask("Old Downloads to Recycle Bin", "0 2 * * 0", new[] { downloads }, 90, "delete", "", Array.Empty<string>())),
            };
            return list;
        }
    }
}
