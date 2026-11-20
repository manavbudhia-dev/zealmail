using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace DeskFence
{
    /// <summary>
    /// The "Focus" layout: ten fences in two columns (six on the left, four on the right), the middle left
    /// free for the wallpaper, filled with the user's own shortcuts found by name. Geometry is in the pixel
    /// space of a 1672 x 893 work area and scaled to the real monitor (same as the earlier version).
    /// </summary>
    internal static class FocusLayout
    {
        public const double DesignW = 1672, DesignH = 893;
        const double LeftX = 12, LeftW = 396, RightX = 1339, RightW = 321;

        public sealed class Item
        {
            public string Label;
            public string[] Names; // what to look for on the Desktop / Start Menu / Documents
            public bool Folder;
            public string Special; // a shell: place (This PC, Recycle Bin, Control Panel) or "downloads"
        }

        public sealed class FenceDef
        {
            public string Name;
            public bool Right;
            public double Y, H;
            public Item[] Items;
            public double X => Right ? RightX : LeftX;
            public double W => Right ? RightW : LeftW;
        }

        static Item App(string label, params string[] names) => new Item { Label = label, Names = names.Length > 0 ? names : new[] { label } };
        static Item Dir(string label, params string[] names) => new Item { Label = label, Names = names.Length > 0 ? names : new[] { label }, Folder = true };

        public static readonly FenceDef[] Preset =
        {
            new FenceDef { Name = "System & Tools", Y = 13, H = 127, Items = new[]
            {
                new Item { Label = "This PC", Special = "shell:MyComputerFolder" },
                new Item { Label = "Recycle Bin", Special = "shell:RecycleBinFolder" },
                new Item { Label = "Control Panel", Special = "shell:ControlPanelFolder" },
            } },
            new FenceDef { Name = "Work & Projects", Y = 152, H = 140, Items = new[] { App("Chrome", "google chrome", "chrome"), App("Brave", "brave"), App("Visual Studio Code", "visual studio code", "vs code", "vscode"), App("Docker Desktop", "docker desktop", "docker") } },
            new FenceDef { Name = "Communication", Y = 304, H = 131, Items = new[] { App("Telegram"), App("Outlook", "outlook", "outlook classic", "new outlook"), App("Zoom", "zoom workplace", "zoom"), App("WhatsApp") } },
            new FenceDef { Name = "Creative & Design", Y = 447, H = 139, Items = new[] { App("Adobe Acrobat", "adobe acrobat", "acrobat"), App("Adobe Express", "adobe express", "express"), App("Screenshot", "screenshot", "snipping tool", "snip"), App("OBS Studio", "obs studio", "obs") } },
            new FenceDef { Name = "Productivity & Utilities", Y = 598, H = 130, Items = new[] { App("Notion"), App("Calendar", "google calendar", "calendar"), App("Everything"), App("Snipboard Pro", "snipboard pro", "snipboard") } },
            new FenceDef { Name = "Files & Documents", Y = 740, H = 129, Items = new[] { Dir("Project Files", "project files"), Dir("Work Docs", "work docs", "work documents"), new Item { Label = "Downloads", Special = "downloads", Folder = true }, Dir("Outputs", "outputs") } },
            new FenceDef { Name = "Learning & Reference", Right = true, Y = 13, H = 149, Items = new[] { App("Flash Calculation"), App("Keychron"), App("OpenCode", "opencode", "open code"), App("NVIDIA App") } },
            new FenceDef { Name = "Media & Entertainment", Right = true, Y = 174, H = 132, Items = new[] { App("YouTube"), App("UltraViewer"), App("VLC", "vlc media player", "vlc"), App("Photos") } },
            new FenceDef { Name = "Utilities", Right = true, Y = 320, H = 127, Items = new[] { App("FXSound"), App("WinSCP"), App("Hue Sync"), App("Antigravity") } },
            new FenceDef { Name = "Personal", Right = true, Y = 461, H = 139, Items = new[] { Dir("School Materials"), Dir("Finance"), Dir("Health"), Dir("Misc") } },
        };

        // ================= finding the user's own shortcuts by name =================
        sealed class Candidate { public string Name, Norm, Path, Source; public bool IsDir; }

        static readonly Regex SkipStartMenu = new Regex(@"\b(uninstall|uninstaller|readme|release notes|license|documentation|manual|help|website|support|repair)\b");

        public static string Normalize(string text)
        {
            string s = text.ToLowerInvariant();
            s = Regex.Replace(s, @"\.(lnk|url|exe)$", "");
            s = Regex.Replace(s, @"\s*-\s*shortcut$", "");
            s = Regex.Replace(s, @"[^a-z0-9]+", " ");
            return s.Trim();
        }

        static List<Candidate> Collect()
        {
            var found = new List<Candidate>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            void Visit(string dir, string source, int depth, int level, bool dirs, bool files, string[] exts)
            {
                if (found.Count > 6000) return;
                IEnumerable<FileSystemInfo> entries;
                try { entries = new DirectoryInfo(dir).EnumerateFileSystemInfos().ToList(); }
                catch { return; } // missing / no access: that source has nothing to offer
                foreach (var e in entries)
                {
                    if (e.Name.StartsWith(".") || e.Name.Equals("desktop.ini", StringComparison.OrdinalIgnoreCase)) continue;
                    if (e is DirectoryInfo)
                    {
                        if (dirs && seen.Add(e.FullName)) found.Add(new Candidate { Name = e.Name, Norm = Normalize(e.Name), Path = e.FullName, IsDir = true, Source = source });
                        if (level < depth) Visit(e.FullName, source, depth, level + 1, dirs, files, exts);
                    }
                    else if (files)
                    {
                        if (exts != null && !exts.Contains(e.Extension.ToLowerInvariant())) continue;
                        if (source == "start" && SkipStartMenu.IsMatch(Normalize(e.Name))) continue;
                        if (seen.Add(e.FullName)) found.Add(new Candidate { Name = e.Name, Norm = Normalize(e.Name), Path = e.FullName, IsDir = false, Source = source });
                    }
                }
            }
            var desktops = new List<string> { Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory) };
            var starts = new[] { Environment.GetFolderPath(Environment.SpecialFolder.Programs), Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms) };
            foreach (var d in desktops.Where(d => !string.IsNullOrEmpty(d))) Visit(d, "desktop", 1, 1, true, true, new[] { ".lnk", ".url", ".exe" });
            foreach (var d in starts.Where(d => !string.IsNullOrEmpty(d))) Visit(d, "start", 4, 1, false, true, new[] { ".lnk" });
            Visit(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "docs", 1, 1, true, false, null);
            return found;
        }

        static double MatchScore(string candidate, string wanted)
        {
            if (wanted.Length == 0 || candidate.Length == 0) return 0;
            if (candidate == wanted) return 100;
            if (candidate.StartsWith(wanted + " ")) return 70; // "google chrome canary" for "google chrome"
            if (candidate.EndsWith(" " + wanted)) return 62;
            if ((" " + candidate + " ").Contains(" " + wanted + " ")) return 55;
            if (wanted.Length >= 5 && candidate.Contains(wanted)) return 40;
            return 0;
        }

        static readonly Dictionary<string, double> SourceBonus = new Dictionary<string, double> { ["desktop"] = 6, ["docs"] = 4, ["start"] = 3 };

        /// <summary>The best matching path for each preset item (null = not on this PC).</summary>
        public static Dictionary<Item, string> Find()
        {
            var candidates = Collect();
            var result = new Dictionary<Item, string>();
            string downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            foreach (var def in Preset)
            {
                foreach (var item in def.Items)
                {
                    if (item.Special == "downloads") { result[item] = Directory.Exists(downloads) ? downloads : null; continue; }
                    if (item.Special != null) { result[item] = item.Special; continue; }
                    var wanted = item.Names.Select(Normalize).Where(n => n.Length > 0).ToList();
                    Candidate best = null;
                    double bestScore = 0;
                    foreach (var c in candidates)
                    {
                        if (item.Folder != c.IsDir) continue;
                        double score = wanted.Max(w => MatchScore(c.Norm, w));
                        if (score == 0) continue;
                        score += SourceBonus.TryGetValue(c.Source, out var bonus) ? bonus : 0;
                        score -= c.Norm.Length * 0.05; // among equals prefer the plainer name
                        if (score > bestScore) { bestScore = score; best = c; }
                    }
                    result[item] = best?.Path;
                }
            }
            return result;
        }
    }
}
