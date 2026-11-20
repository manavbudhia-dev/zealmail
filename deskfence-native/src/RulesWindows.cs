using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace DeskFence
{
    /// <summary>Rules of ONE fence: quick rules, the list (on/off, Sort now, edit, delete), add a rule.</summary>
    internal sealed class FenceRulesWindow : FluentWindow
    {
        readonly DeskFenceApp app;
        readonly FenceWindow fence;
        string message;

        public FenceRulesWindow(DeskFenceApp app, FenceWindow fence) : base("Rules for “" + fence.Data.Name + "”", 520)
        {
            this.app = app;
            this.fence = fence;
            Build();
        }

        JsonArray Rules
        {
            get
            {
                if (fence.Data.Raw["rules"] is not JsonArray rules)
                {
                    rules = new JsonArray();
                    fence.Data.Raw["rules"] = rules;
                }
                return rules;
            }
        }

        void Changed()
        {
            fence.Data.Touch();
            app.SaveSoon();
            app.RulesChanged();
            Build();
        }

        void Build()
        {
            var stack = new StackPanel();
            stack.Children.Add(new TextBlock { Text = "New items in the watched folders that match go into this fence while DeskFence runs.", Foreground = Subtle, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(2, 4, 0, 0) });

            var quick = new WrapPanel();
            foreach (var q in QuickRule.All)
            {
                bool has = Rules.OfType<JsonObject>().Any(r => Theme.Str(r["preset"]) == q.Key);
                var chip = Chip(q.Label, has, () =>
                {
                    if (has) return;
                    var rule = q.MakeRule(fence.Data.Id, DeskFenceApp.DesktopPath());
                    Rules.Add(rule);
                    Changed();
                    OfferSortNow(rule);
                });
                chip.ToolTip = has ? "Already a rule of this fence" : $"New {q.Label.ToLowerInvariant()} on the Desktop go into this fence";
                quick.Children.Add(chip);
            }
            stack.Children.Add(Section("Quick rules: collect from the Desktop", quick));

            if (!string.IsNullOrEmpty(message))
                stack.Children.Add(new TextBlock { Text = message, Foreground = Fg, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(2, 10, 0, 0) });

            var list = new StackPanel();
            if (Rules.Count == 0)
                list.Children.Add(new TextBlock { Text = "No rules yet. Example: “File extension is pdf” watching your Downloads folder.", Foreground = Subtle, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 8) });
            foreach (var rule in Rules.OfType<JsonObject>().ToList())
                list.Children.Add(RuleRow(rule));
            stack.Children.Add(Section("Rules", list));

            stack.Children.Add(Buttons(
                Btn("Sort now (all rules)", () => SortNow(null)),
                Btn("Add rule", () =>
                {
                    var editor = new RuleEditorWindow(app, null, fence.Data.Id) { Owner = this };
                    if (editor.ShowDialog() == true && editor.Result != null)
                    {
                        Rules.Add(editor.Result);
                        Changed();
                        OfferSortNow(editor.Result);
                    }
                }, primary: true)));
            Body.Content = stack;
        }

        UIElement RuleRow(JsonObject rule)
        {
            var grid = new Grid { Margin = new Thickness(0, 6, 0, 6) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var toggle = Switch(RuleEngine.Enabled(rule), on => { rule["enabled"] = on; Changed(); });
            ((FrameworkElement)toggle).Margin = new Thickness(0, 2, 10, 0);
            ((FrameworkElement)toggle).VerticalAlignment = VerticalAlignment.Top;
            grid.Children.Add(toggle);
            var text = new StackPanel();
            text.Children.Add(new TextBlock { Text = Theme.Str(rule["name"]) ?? "Rule", FontWeight = FontWeights.SemiBold, Foreground = Fg });
            text.Children.Add(new TextBlock { Text = RuleEngine.Describe(rule), Foreground = Subtle, TextWrapping = TextWrapping.Wrap, FontSize = 12 });
            text.Children.Add(new TextBlock { Text = "Watching: " + (string.Join(", ", RuleEngine.WatchPaths(rule)) is string w && w.Length > 0 ? w : "no folder yet"), Foreground = Subtle, TextWrapping = TextWrapping.Wrap, FontSize = 12 });
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Top };
            buttons.Children.Add(Btn("Sort now", () => SortNow(rule)));
            buttons.Children.Add(Btn("Edit", () =>
            {
                var editor = new RuleEditorWindow(app, rule, fence.Data.Id) { Owner = this };
                if (editor.ShowDialog() == true && editor.Result != null)
                {
                    int index = Rules.IndexOf(rule);
                    Rules[index] = editor.Result;
                    Changed();
                }
            }));
            buttons.Children.Add(Btn("Delete", () =>
            {
                if (MessageBox.Show(this, $"Delete the rule “{Theme.Str(rule["name"])}”?", "DeskFence", MessageBoxButton.OKCancel) != MessageBoxResult.OK) return;
                Rules.Remove(rule);
                Changed();
            }));
            foreach (Button b in buttons.Children) { b.MinWidth = 0; b.Padding = new Thickness(10, 4, 10, 4); }
            Grid.SetColumn(buttons, 2);
            grid.Children.Add(buttons);
            return grid;
        }

        void OfferSortNow(JsonObject rule)
        {
            int count = app.CountExisting(new[] { rule });
            if (count == 0) return;
            if (MessageBox.Show(this, $"{count} matching item(s) are already there. Move them into “{fence.Data.Name}” now?", "DeskFence", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
                SortNow(rule, ask: false);
        }

        void SortNow(JsonObject rule, bool ask = true)
        {
            var only = rule == null ? Rules.OfType<JsonObject>().ToArray() : new[] { rule };
            int count = app.CountExisting(only);
            if (count == 0)
            {
                message = "Nothing to sort right now: no item in the watched folders matches.";
                Build();
                return;
            }
            if (ask && MessageBox.Show(this, $"Move the {count} matching item(s) that are already there into “{fence.Data.Name}”?", "DeskFence", MessageBoxButton.OKCancel, MessageBoxImage.Question) != MessageBoxResult.OK) return;
            int moved = app.SortExisting(only);
            message = $"{moved} item(s) moved into “{fence.Data.Name}”.";
            Build();
        }
    }

    /// <summary>Rules that are not stored on one fence (tray > Automation rules): each names its target fence.</summary>
    internal sealed class AutomationWindow : FluentWindow
    {
        readonly DeskFenceApp app;
        string message;

        public AutomationWindow(DeskFenceApp app) : base("Automation rules", 560)
        {
            this.app = app;
            Build();
        }

        void Build()
        {
            var stack = new StackPanel();
            stack.Children.Add(new TextBlock { Text = "New items that match a rule are moved or copied into a fence while DeskFence runs. Rules of a single fence are under that fence's menu (Rules) and run first.", Foreground = Subtle, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(2, 4, 0, 0) });
            if (!string.IsNullOrEmpty(message)) stack.Children.Add(new TextBlock { Text = message, Foreground = Fg, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(2, 10, 0, 0) });

            var list = new StackPanel();
            var rules = app.GlobalRules;
            if (rules.Count == 0) list.Children.Add(new TextBlock { Text = "No rules yet.", Foreground = Subtle, Margin = new Thickness(0, 8, 0, 8) });
            foreach (var rule in rules.OfType<JsonObject>().ToList())
            {
                var row = new Grid { Margin = new Thickness(0, 6, 0, 6) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var toggle = (FrameworkElement)Switch(RuleEngine.Enabled(rule), on => { rule["enabled"] = on; app.SaveGlobalRules(); Build(); });
                toggle.Margin = new Thickness(0, 2, 10, 0);
                toggle.VerticalAlignment = VerticalAlignment.Top;
                row.Children.Add(toggle);
                string target = app.FenceName(Theme.Str(rule["targetFenceId"]));
                var text = new StackPanel();
                text.Children.Add(new TextBlock { Text = Theme.Str(rule["name"]) ?? "Rule", FontWeight = FontWeights.SemiBold, Foreground = Fg });
                text.Children.Add(new TextBlock { Text = RuleEngine.Describe(rule), Foreground = Subtle, TextWrapping = TextWrapping.Wrap, FontSize = 12 });
                text.Children.Add(new TextBlock { Text = target != null ? "Into fence: " + target : "The target fence no longer exists: this rule does nothing", Foreground = target != null ? Subtle : Brushes.Orange, FontSize = 12 });
                Grid.SetColumn(text, 1);
                row.Children.Add(text);
                var buttons = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Top };
                buttons.Children.Add(Btn("Edit", () =>
                {
                    var editor = new RuleEditorWindow(app, rule, null) { Owner = this };
                    if (editor.ShowDialog() == true && editor.Result != null)
                    {
                        rules[rules.IndexOf(rule)] = editor.Result;
                        app.SaveGlobalRules();
                        Build();
                    }
                }));
                buttons.Children.Add(Btn("Delete", () =>
                {
                    if (MessageBox.Show(this, $"Delete the rule “{Theme.Str(rule["name"])}”?", "DeskFence", MessageBoxButton.OKCancel) != MessageBoxResult.OK) return;
                    rules.Remove(rule);
                    app.SaveGlobalRules();
                    Build();
                }));
                foreach (Button b in buttons.Children) { b.MinWidth = 0; b.Padding = new Thickness(10, 4, 10, 4); }
                Grid.SetColumn(buttons, 2);
                row.Children.Add(buttons);
                list.Children.Add(row);
            }
            stack.Children.Add(Section("Rules", list));
            stack.Children.Add(Buttons(
                Btn("Sort existing files now", () =>
                {
                    int count = app.CountExisting(null);
                    if (count == 0) { message = "Nothing to sort: no item in a watched folder matches a rule."; Build(); return; }
                    if (MessageBox.Show(this, $"Apply all rules to what is already in their folders?\n\n{count} item(s) will be moved into fences.", "DeskFence", MessageBoxButton.OKCancel) != MessageBoxResult.OK) return;
                    message = app.SortExisting(null) + " item(s) moved into fences.";
                    Build();
                }),
                Btn("Add rule", () =>
                {
                    if (app.FenceCount == 0) { MessageBox.Show(this, "Create a fence first: a rule needs a fence to put files into.", "DeskFence"); return; }
                    var editor = new RuleEditorWindow(app, null, null) { Owner = this };
                    if (editor.ShowDialog() == true && editor.Result != null)
                    {
                        rules.Add(editor.Result);
                        app.SaveGlobalRules();
                        Build();
                    }
                }, primary: true)));
            Body.Content = stack;
        }
    }

    /// <summary>Create / edit one rule: name, conditions, move or copy, watched folders, target fence.</summary>
    internal sealed class RuleEditorWindow : FluentWindow
    {
        public JsonObject Result { get; private set; }
        readonly DeskFenceApp app;
        readonly string scopedFenceId;
        readonly string originalId, originalPreset;
        string name;
        string action;
        string targetFenceId;
        readonly List<JsonObject> conditions;
        readonly List<string> watchPaths;

        public RuleEditorWindow(DeskFenceApp app, JsonObject rule, string scopedFenceId) : base(rule == null ? "New rule" : "Edit rule", 560)
        {
            this.app = app;
            this.scopedFenceId = scopedFenceId;
            originalId = Theme.Str(rule?["id"]);
            originalPreset = Theme.Str(rule?["preset"]);
            name = Theme.Str(rule?["name"]) ?? "";
            action = Theme.Str(rule?["action"]) == "copy" ? "copy" : "move";
            targetFenceId = scopedFenceId ?? Theme.Str(rule?["targetFenceId"]) ?? app.FirstFenceId;
            conditions = (rule?["conditions"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(c => (JsonObject)JsonNode.Parse(c.ToJsonString())).ToList();
            watchPaths = rule == null ? new List<string> { DeskFenceApp.DesktopPath() } : RuleEngine.WatchPaths(rule).ToList();
            if (conditions.Count == 0) conditions.Add(RuleEngine.Condition("extension", "equals", ""));
            Build();
        }

        void Build()
        {
            var stack = new StackPanel();
            stack.Children.Add(Section("Rule", Row("Name", Field(name, v => name = v)),
                Row("Action", Choice(new[] { ("move", "Move into the fence"), ("copy", "Copy into the fence") }, action, v => action = v ?? "move", 200)),
                scopedFenceId == null ? Row("Fence", Choice(app.FenceChoices(), targetFenceId, v => targetFenceId = v, 200)) : null));

            var conditionList = new StackPanel();
            foreach (var condition in conditions.ToList())
            {
                var c = condition;
                var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 4) };
                string type = Theme.Str(c["type"]) ?? "extension";
                var typeBox = Choice(RuleEngine.ConditionTypes.Select(t => (t, RuleEngine.Label(t))), type, v =>
                {
                    c["type"] = v;
                    c["operator"] = RuleEngine.OperatorsFor(v)[0];
                    Build();
                }, 160);
                var opBox = Choice(RuleEngine.OperatorsFor(type).Select(o => (o, RuleEngine.Label(o))), Theme.Str(c["operator"]) ?? "equals", v => c["operator"] = v, 120);
                opBox.Margin = new Thickness(6, 0, 6, 0);
                string hint = type switch
                {
                    "extension" => "pdf docx (several = any)",
                    "size" => "10 MB",
                    "date" => "days, e.g. 30",
                    "kind" => "file or folder",
                    _ => "",
                };
                var value = Field(Theme.Str(c["value"]) ?? FenceData.Num(c["value"], 0).ToString(), v => c["value"] = v, 150);
                value.ToolTip = hint;
                row.Children.Add(typeBox);
                row.Children.Add(opBox);
                row.Children.Add(value);
                var remove = Btn("✕", () => { conditions.Remove(c); if (conditions.Count == 0) conditions.Add(RuleEngine.Condition("extension", "equals", "")); Build(); });
                remove.MinWidth = 0;
                remove.Padding = new Thickness(8, 4, 8, 4);
                row.Children.Add(remove);
                conditionList.Children.Add(row);
            }
            var addCondition = Btn("Add condition", () => { conditions.Add(RuleEngine.Condition("name", "contains", "")); Build(); });
            addCondition.HorizontalAlignment = HorizontalAlignment.Left;
            addCondition.Margin = new Thickness(0, 6, 0, 4);
            conditionList.Children.Add(addCondition);
            stack.Children.Add(Section("All of these must match", conditionList));

            var folders = new StackPanel();
            foreach (var path in watchPaths.ToList())
            {
                var p = path;
                var row = new Grid { Margin = new Thickness(0, 3, 0, 3) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.Children.Add(new TextBlock { Text = p, Foreground = Fg, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, ToolTip = p });
                var remove = Btn("Remove", () => { watchPaths.Remove(p); Build(); });
                remove.MinWidth = 0;
                remove.Padding = new Thickness(10, 3, 10, 3);
                Grid.SetColumn(remove, 1);
                row.Children.Add(remove);
                folders.Children.Add(row);
            }
            var addFolder = Btn("Add folder…", () =>
            {
                using var dialog = new System.Windows.Forms.FolderBrowserDialog { Description = "Watch this folder for new items", UseDescriptionForTitle = true };
                if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK && !string.IsNullOrEmpty(dialog.SelectedPath) && !watchPaths.Contains(dialog.SelectedPath))
                {
                    watchPaths.Add(dialog.SelectedPath);
                    Build();
                }
            });
            addFolder.HorizontalAlignment = HorizontalAlignment.Left;
            addFolder.Margin = new Thickness(0, 6, 0, 4);
            folders.Children.Add(addFolder);
            stack.Children.Add(Section("Watch these folders", folders));

            stack.Children.Add(Buttons(Btn("Cancel", () => { DialogResult = false; }), Btn("Save", Save, primary: true)));
            Body.Content = stack;
        }

        void Save()
        {
            var valid = conditions.Where(c => !string.IsNullOrWhiteSpace(Theme.Str(c["value"]))).ToList();
            if (string.IsNullOrWhiteSpace(name)) { MessageBox.Show(this, "Give the rule a name.", "DeskFence"); return; }
            if (valid.Count == 0) { MessageBox.Show(this, "Add at least one condition with a value.", "DeskFence"); return; }
            if (watchPaths.Count == 0) { MessageBox.Show(this, "Choose at least one folder to watch.", "DeskFence"); return; }
            if (string.IsNullOrEmpty(targetFenceId)) { MessageBox.Show(this, "Choose the fence the items go into.", "DeskFence"); return; }
            Result = RuleEngine.NewRule(name.Trim(), valid, action, targetFenceId, watchPaths, originalPreset);
            if (originalId != null) Result["id"] = originalId; // editing keeps the rule's identity
            DialogResult = true;
        }
    }
}
