using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;

namespace DeskFence
{
    /// <summary>Scheduled cleanups: list (on/off, Preview, Run now, edit, delete), presets, add a custom one.</summary>
    internal sealed class CleanupWindow : FluentWindow
    {
        readonly DeskFenceApp app;
        string message;

        public CleanupWindow(DeskFenceApp app) : base("Scheduled cleanup", 600)
        {
            this.app = app;
            Build();
        }

        static string Summary(List<string> paths) => paths.Count == 0 ? "" : "\n\n" + string.Join("\n", paths.Take(8).Select(p => "•  " + Path.GetFileName(p))) + (paths.Count > 8 ? $"\n…and {paths.Count - 8} more" : "");
        static string EffectText(JsonObject task) => Cleanup.Action(task) == "delete" ? "sent to the Recycle Bin" : "moved to " + Cleanup.Destination(task);

        void Build()
        {
            var tasks = app.ScheduledTasks;
            var stack = new StackPanel();
            stack.Children.Add(new TextBlock { Text = "Runs while DeskFence is running; a run missed while the PC was off happens once at the next start. Only items older than the set number of days are touched.", Foreground = Subtle, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(2, 4, 0, 0) });
            if (!string.IsNullOrEmpty(message)) stack.Children.Add(new TextBlock { Text = message, Foreground = Fg, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(2, 10, 0, 0) });

            var list = new StackPanel();
            if (tasks.Count == 0) list.Children.Add(new TextBlock { Text = "No scheduled cleanup yet: add one from the presets below.", Foreground = Subtle, Margin = new Thickness(0, 8, 0, 8) });
            foreach (var task in tasks.OfType<JsonObject>().ToList())
            {
                var row = new Grid { Margin = new Thickness(0, 6, 0, 6) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var toggle = (FrameworkElement)Switch(Cleanup.Enabled(task), on =>
                {
                    task["enabled"] = on;
                    if (on) Cleanup.SetNextRun(task, DateTime.Now); // turning back on never "catches up" for the time it was off
                    app.SaveScheduledTasks();
                    Build();
                });
                toggle.Margin = new Thickness(0, 2, 10, 0);
                toggle.VerticalAlignment = VerticalAlignment.Top;
                row.Children.Add(toggle);
                var text = new StackPanel();
                text.Children.Add(new TextBlock { Text = Theme.Str(task["name"]) ?? "Cleanup", FontWeight = FontWeights.SemiBold, Foreground = Fg });
                string what = $"{Cron.Describe(Theme.Str(task["schedule"]))} · items older than {Cleanup.OlderThan(task)} day(s) " +
                              (Cleanup.Action(task) == "delete" ? "go to the Recycle Bin" : "move to the archive folder") +
                              (Cleanup.Extensions(task).Count > 0 ? " · only ." + string.Join(" .", Cleanup.Extensions(task)) : "");
                text.Children.Add(new TextBlock { Text = what, Foreground = Subtle, FontSize = 12, TextWrapping = TextWrapping.Wrap });
                text.Children.Add(new TextBlock { Text = "Folder: " + string.Join(", ", Cleanup.Folders(task)), Foreground = Subtle, FontSize = 12, TextWrapping = TextWrapping.Wrap });
                double next = FenceData.Num(task["nextRun"], 0), last = FenceData.Num(task["lastRun"], 0);
                string when = (Cleanup.Enabled(task) && next > 0 ? "Next: " + DateTimeOffset.FromUnixTimeMilliseconds((long)next).LocalDateTime.ToString("g", CultureInfo.CurrentCulture) : "Paused") +
                              (last > 0 ? " · Last: " + DateTimeOffset.FromUnixTimeMilliseconds((long)last).LocalDateTime.ToString("g", CultureInfo.CurrentCulture) + " (" + (Theme.Str(task["lastResult"]) ?? "") + ")" : "");
                text.Children.Add(new TextBlock { Text = when, Foreground = Subtle, FontSize = 12, TextWrapping = TextWrapping.Wrap });
                var buttons = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
                buttons.Children.Add(Btn("Preview", () =>
                {
                    var r = Cleanup.Run(task, true);
                    MessageBox.Show(this, r.Matched.Count == 0 ? "Nothing to do right now." : $"Right now {r.Matched.Count} item(s) would be {EffectText(task)}:{Summary(r.Matched)}" +
                        (r.Failed.Count > 0 ? "\n\nProblems:\n" + string.Join("\n", r.Failed.Select(f => "•  " + f.Error)) : ""), "DeskFence");
                }));
                buttons.Children.Add(Btn("Run now", () =>
                {
                    var r = Cleanup.Run(task, true);
                    if (r.Matched.Count == 0) { message = $"“{Theme.Str(task["name"])}”: nothing to do."; Build(); return; }
                    if (MessageBox.Show(this, $"Run “{Theme.Str(task["name"])}” now?\n\n{r.Matched.Count} item(s) will be {EffectText(task)}.", "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;
                    message = app.RunCleanupNow(task);
                    Build();
                }));
                buttons.Children.Add(Btn("Edit", () =>
                {
                    var editor = new CleanupEditorWindow(task) { Owner = this };
                    if (editor.ShowDialog() == true && editor.Result != null)
                    {
                        tasks[tasks.IndexOf(task)] = editor.Result;
                        app.SaveScheduledTasks();
                        Build();
                    }
                }));
                buttons.Children.Add(Btn("Delete", () =>
                {
                    if (MessageBox.Show(this, $"Delete “{Theme.Str(task["name"])}”?\n\nItems it already archived stay where they are.", "DeskFence", MessageBoxButton.OKCancel) != MessageBoxResult.OK) return;
                    tasks.Remove(task);
                    app.SaveScheduledTasks();
                    Build();
                }));
                foreach (Button b in buttons.Children) { b.MinWidth = 0; b.Padding = new Thickness(10, 4, 10, 4); b.Margin = new Thickness(0, 0, 6, 0); }
                text.Children.Add(buttons);
                Grid.SetColumn(text, 1);
                row.Children.Add(text);
                list.Children.Add(row);
            }
            stack.Children.Add(Section("Your scheduled cleanups", list));

            var presets = new StackPanel();
            foreach (var (description, task) in Cleanup.Presets())
            {
                var row = new Grid { Margin = new Thickness(0, 4, 0, 4) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var t = new StackPanel();
                t.Children.Add(new TextBlock { Text = Theme.Str(task["name"]), Foreground = Fg, FontWeight = FontWeights.SemiBold });
                t.Children.Add(new TextBlock { Text = description, Foreground = Subtle, FontSize = 12, TextWrapping = TextWrapping.Wrap });
                row.Children.Add(t);
                var add = Btn("Add", () =>
                {
                    var preview = Cleanup.Run(task, true);
                    if (MessageBox.Show(this, $"Add “{Theme.Str(task["name"])}”?\n\n{description}\n\n" + (preview.Matched.Count == 0 ? "Right now nothing matches." : $"Right now {preview.Matched.Count} item(s) would be {EffectText(task)}:{Summary(preview.Matched)}"),
                            "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;
                    tasks.Add(task);
                    app.SaveScheduledTasks();
                    message = $"Added “{Theme.Str(task["name"])}”.";
                    Build();
                });
                add.MinWidth = 0;
                add.Padding = new Thickness(12, 4, 12, 4);
                add.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(add, 1);
                row.Children.Add(add);
                presets.Children.Add(row);
            }
            stack.Children.Add(Section("Presets", presets));
            stack.Children.Add(Buttons(Btn("Build your own…", () =>
            {
                var editor = new CleanupEditorWindow(null) { Owner = this };
                if (editor.ShowDialog() == true && editor.Result != null)
                {
                    tasks.Add(editor.Result);
                    app.SaveScheduledTasks();
                    Build();
                }
            }, primary: true)));
            Body.Content = stack;
        }
    }

    /// <summary>Create / edit one cleanup: folders, older than, archive or Recycle Bin, file types, schedule.</summary>
    internal sealed class CleanupEditorWindow : FluentWindow
    {
        public JsonObject Result { get; private set; }
        readonly string originalId;
        string name;
        readonly List<string> folders;
        int olderThan;
        string action;
        string destination;
        string extensions;
        string frequency = "weekly";
        int weekday = 0, monthDay = 1, hour = 3, minute = 0;

        public CleanupEditorWindow(JsonObject task) : base(task == null ? "New cleanup" : "Edit cleanup", 560)
        {
            originalId = Theme.Str(task?["id"]);
            name = Theme.Str(task?["name"]) ?? "";
            folders = task == null ? new List<string>() : Cleanup.Folders(task).ToList();
            olderThan = task == null ? 30 : Math.Max(1, Cleanup.OlderThan(task));
            action = task == null ? "archive" : Cleanup.Action(task);
            destination = task == null ? "" : Cleanup.Destination(task) ?? "";
            extensions = task == null ? "" : string.Join(" ", Cleanup.Extensions(task));
            // read back the schedules this editor makes
            var p = (Theme.Str(task?["schedule"]) ?? "0 3 * * 0").Split(' ');
            if (p.Length == 5 && int.TryParse(p[0], out int m) && int.TryParse(p[1], out int h))
            {
                minute = m;
                hour = h;
                if (p[2] == "*" && p[4] == "*") frequency = "daily";
                else if (p[2] == "*" && int.TryParse(p[4], out int d)) { frequency = "weekly"; weekday = d % 7; }
                else if (int.TryParse(p[2], out int md)) { frequency = "monthly"; monthDay = md; }
            }
            Build();
        }

        string Schedule => frequency switch
        {
            "daily" => $"{minute} {hour} * * *",
            "monthly" => $"{minute} {hour} {monthDay} * *",
            _ => $"{minute} {hour} * * {weekday}",
        };

        void Build()
        {
            var stack = new StackPanel();
            stack.Children.Add(Section("Cleanup", Row("Name", Field(name, v => name = v))));

            var folderList = new StackPanel();
            foreach (var f in folders.ToList())
            {
                var row = new Grid { Margin = new Thickness(0, 3, 0, 3) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.Children.Add(new TextBlock { Text = f, Foreground = Fg, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, ToolTip = f });
                var remove = Btn("Remove", () => { folders.Remove(f); Build(); });
                remove.MinWidth = 0;
                remove.Padding = new Thickness(10, 3, 10, 3);
                Grid.SetColumn(remove, 1);
                row.Children.Add(remove);
                folderList.Children.Add(row);
            }
            var add = Btn("Add folder…", () =>
            {
                string picked = PickFolder("Clean up items in this folder");
                if (picked == null) return;
                if (Cleanup.IsProtected(picked)) { MessageBox.Show(this, "That is a system folder or a whole drive: DeskFence never cleans those.", "DeskFence"); return; }
                if (!folders.Contains(picked)) folders.Add(picked);
                Build();
            });
            add.HorizontalAlignment = HorizontalAlignment.Left;
            add.Margin = new Thickness(0, 6, 0, 4);
            folderList.Children.Add(add);
            stack.Children.Add(Section("Folders to clean", folderList));

            var destRow = new StackPanel { Orientation = Orientation.Horizontal };
            destRow.Children.Add(new TextBlock { Text = string.IsNullOrEmpty(destination) ? "(not chosen)" : destination, Foreground = Fg, MaxWidth = 240, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0), ToolTip = destination });
            destRow.Children.Add(Btn("Choose…", () => { string picked = PickFolder("Archive folder"); if (picked != null) { destination = picked; Build(); } }));
            stack.Children.Add(Section("What to do",
                Row("Only items older than", SliderRow(olderThan, 1, 365, 1, v => olderThan = (int)v, " days")),
                Row("Then", Choice(new[] { ("archive", "Move to an archive folder"), ("delete", "Send to the Recycle Bin") }, action, v => { action = v ?? "archive"; Build(); }, 220)),
                action == "archive" ? Row("Archive folder", destRow) : null,
                Row("Only these file types (optional)", Field(extensions, v => extensions = v, 160), "e.g. exe msi zip; empty = every item")));

            var days = Enumerable.Range(0, 7).Select(d => (d.ToString(), CultureInfo.CurrentCulture.DateTimeFormat.GetDayName((DayOfWeek)d)));
            var timeRow = new StackPanel { Orientation = Orientation.Horizontal };
            timeRow.Children.Add(Choice(Enumerable.Range(0, 24).Select(h => (h.ToString(), h.ToString("00"))), hour.ToString(), v => hour = int.Parse(v ?? "3"), 70));
            timeRow.Children.Add(new TextBlock { Text = " : ", Foreground = Fg, VerticalAlignment = VerticalAlignment.Center });
            timeRow.Children.Add(Choice(new[] { 0, 15, 30, 45 }.Select(m => (m.ToString(), m.ToString("00"))), minute.ToString(), v => minute = int.Parse(v ?? "0"), 70));
            stack.Children.Add(Section("When",
                Row("Repeat", Choice(new[] { ("daily", "Every day"), ("weekly", "Every week"), ("monthly", "Every month") }, frequency, v => { frequency = v ?? "weekly"; Build(); }, 160)),
                frequency == "weekly" ? Row("On", Choice(days, weekday.ToString(), v => weekday = int.Parse(v ?? "0"), 160)) : null,
                frequency == "monthly" ? Row("On day", Choice(Enumerable.Range(1, 28).Select(d => (d.ToString(), d.ToString())), monthDay.ToString(), v => monthDay = int.Parse(v ?? "1"), 80)) : null,
                Row("At", timeRow)));

            stack.Children.Add(Buttons(Btn("Cancel", () => DialogResult = false), Btn("Save", Save, primary: true)));
            Body.Content = stack;
        }

        string PickFolder(string description)
        {
            using var dialog = new System.Windows.Forms.FolderBrowserDialog { Description = description, UseDescriptionForTitle = true };
            return dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK && !string.IsNullOrEmpty(dialog.SelectedPath) ? dialog.SelectedPath : null;
        }

        void Save()
        {
            if (string.IsNullOrWhiteSpace(name)) { MessageBox.Show(this, "Give the cleanup a name.", "DeskFence"); return; }
            if (folders.Count == 0) { MessageBox.Show(this, "Choose at least one folder to clean.", "DeskFence"); return; }
            if (action == "archive" && string.IsNullOrEmpty(destination)) { MessageBox.Show(this, "Choose the archive folder the items move to.", "DeskFence"); return; }
            var exts = extensions.Split(new[] { ' ', ',', ';' }, StringSplitOptions.RemoveEmptyEntries).Select(e => e.TrimStart('.').ToLowerInvariant());
            var task = Cleanup.NewTask(name.Trim(), Schedule, folders, olderThan, action, action == "archive" ? destination : "", exts);
            if (originalId != null) task["id"] = originalId;

            // show exactly what it would touch right now before it is saved
            var preview = Cleanup.Run(task, true);
            string list = preview.Matched.Count == 0 ? "Right now nothing matches." :
                $"Right now {preview.Matched.Count} item(s) would be " + (action == "delete" ? "sent to the Recycle Bin" : "moved to " + destination) + ":\n" +
                string.Join("\n", preview.Matched.Take(6).Select(p => "•  " + Path.GetFileName(p))) + (preview.Matched.Count > 6 ? $"\n…and {preview.Matched.Count - 6} more" : "");
            if (MessageBox.Show(this, $"Save “{name.Trim()}”?\n\nIt runs: {Cron.Describe(Schedule)}.\n\n{list}", "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;
            Result = task;
            DialogResult = true;
        }
    }
}
