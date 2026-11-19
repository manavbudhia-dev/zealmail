using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;

namespace DeskFence
{
    internal static class Program
    {
        [STAThread]
        public static void Main()
        {
            // One DeskFence at a time; starting it again brings hidden fences back
            using var mutex = new Mutex(true, "DeskFence.Native.SingleInstance", out bool first);
            using var showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "DeskFence.Native.Show");
            if (!first)
            {
                showSignal.Set();
                return;
            }

            var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            application.DispatcherUnhandledException += (_, e) =>
            {
                Log.Error("Unhandled", e.Exception);
                e.Handled = true; // a bug in one action must not close every fence
            };
            AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Fatal", e.ExceptionObject as Exception);

            WarnAboutOldVersion();

            var app = new DeskFenceApp();
            application.Dispatcher.BeginInvoke(new Action(app.Start));

            var listener = new Thread(() =>
            {
                while (true)
                {
                    showSignal.WaitOne();
                    application.Dispatcher.BeginInvoke(new Action(() => { if (app.QuickHidden) app.SetQuickHidden(false); }));
                }
            }) { IsBackground = true };
            listener.Start();

            application.Run();
        }

        // The earlier (Electron) DeskFence uses the same fences: both at once would fight over them
        static void WarnAboutOldVersion()
        {
            try
            {
                string me = Environment.ProcessPath ?? "";
                bool oldRunning = Process.GetProcessesByName("DeskFence").Any(p =>
                {
                    try
                    {
                        string path = p.MainModule?.FileName ?? "";
                        return p.Id != Environment.ProcessId && !string.Equals(path, me, StringComparison.OrdinalIgnoreCase) &&
                               Directory.Exists(Path.Combine(Path.GetDirectoryName(path) ?? "", "resources"));
                    }
                    catch
                    {
                        return false;
                    }
                });
                if (oldRunning)
                {
                    MessageBox.Show(
                        "The earlier DeskFence (Electron version) is still running.\n\nQuit it from its tray icon and uninstall it " +
                        "(Settings > Apps > DeskFence). Your fences stay: this version uses the same saved fences.",
                        "DeskFence", MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            catch
            {
                /* just a hint */
            }
        }
    }
}
