using System;
using System.IO;

namespace DeskFence
{
    /// <summary>Small error log in %APPDATA%\deskfence\native.log (kept under 512 KB).</summary>
    internal static class Log
    {
        static readonly object Gate = new object();
        static string File => Path.Combine(Storage.Dir, "native.log");

        public static void Info(string message) => Write("INFO  " + message);

        public static void Error(string message, Exception error = null) =>
            Write("ERROR " + message + (error == null ? "" : ": " + error));

        static void Write(string line)
        {
            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(Storage.Dir);
                    var info = new FileInfo(File);
                    if (info.Exists && info.Length > 512 * 1024) System.IO.File.Move(File, File + ".old", true);
                    System.IO.File.AppendAllText(File, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + Environment.NewLine);
                }
            }
            catch
            {
                /* logging must never break the app */
            }
        }
    }
}
