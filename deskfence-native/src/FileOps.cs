using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

namespace DeskFence
{
    /// <summary>Real file moves for fences: never overwrites, retries while Windows briefly locks a file.</summary>
    internal static class FileOps
    {
        public sealed class Result
        {
            public readonly List<(string From, string To)> Moved = new List<(string, string)>();
            public readonly List<(string Path, string Error)> Failed = new List<(string, string)>();
        }

        public static bool SamePath(string a, string b) =>
            string.Equals(Path.GetFullPath(a).TrimEnd('\\', '/'), Path.GetFullPath(b).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase);

        public static bool IsInside(string child, string parent)
        {
            if (string.IsNullOrEmpty(child) || string.IsNullOrEmpty(parent)) return false;
            string c = Path.GetFullPath(child).TrimEnd('\\', '/') + "\\";
            string p = Path.GetFullPath(parent).TrimEnd('\\', '/') + "\\";
            return c.StartsWith(p, StringComparison.OrdinalIgnoreCase) && c.Length > p.Length;
        }

        /// <summary>"report.pdf" -> "report (1).pdf" -> ... a name not taken yet in `dir`.</summary>
        static string FreeName(string dir, string name, bool isDirectory)
        {
            string ext = isDirectory ? "" : Path.GetExtension(name);
            string stem = isDirectory ? name : Path.GetFileNameWithoutExtension(name);
            for (int i = 0; ; i++)
            {
                string candidate = Path.Combine(dir, i == 0 ? name : stem + " (" + i + ")" + ext);
                if (!File.Exists(candidate) && !Directory.Exists(candidate)) return candidate;
            }
        }

        public static Result MoveInto(IEnumerable<string> paths, string destDir, bool copy = false)
        {
            var result = new Result();
            if (string.IsNullOrWhiteSpace(destDir) || !Path.IsPathRooted(destDir))
            {
                foreach (var p in paths) result.Failed.Add((p, "No valid destination folder"));
                return result;
            }
            Directory.CreateDirectory(destDir);
            foreach (var source in paths)
            {
                try
                {
                    bool isDir = Directory.Exists(source);
                    if (!isDir && !File.Exists(source)) throw new FileNotFoundException("File no longer exists");
                    if (!copy && SamePath(Path.GetDirectoryName(source.TrimEnd('\\', '/')), destDir)) continue; // already there
                    if (isDir && (SamePath(source, destDir) || IsInside(destDir, source))) throw new IOException("Cannot put a folder inside itself");
                    if (Path.GetPathRoot(source) == source) throw new IOException("Cannot move a whole drive");

                    string target = FreeName(destDir, Path.GetFileName(source.TrimEnd('\\', '/')), isDir);
                    if (copy)
                    {
                        if (isDir) CopyDirectory(source, target);
                        else File.Copy(source, target);
                    }
                    else
                    {
                        Retry(() =>
                        {
                            bool sameDrive = string.Equals(Path.GetPathRoot(Path.GetFullPath(source)), Path.GetPathRoot(Path.GetFullPath(destDir)), StringComparison.OrdinalIgnoreCase);
                            if (isDir && !sameDrive)
                            {
                                // a folder to another drive: copy first, remove the original only after
                                CopyDirectory(source, target);
                                Directory.Delete(source, true);
                            }
                            else if (isDir) Directory.Move(source, target);
                            else File.Move(source, target);
                        });
                    }
                    result.Moved.Add((source, target));
                }
                catch (Exception error)
                {
                    result.Failed.Add((source, Friendly(error, Directory.Exists(source))));
                }
            }
            return result;
        }

        static void CopyDirectory(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var file in Directory.GetFiles(from)) File.Copy(file, Path.Combine(to, Path.GetFileName(file)));
            foreach (var dir in Directory.GetDirectories(from)) CopyDirectory(dir, Path.Combine(to, Path.GetFileName(dir)));
        }

        // Antivirus, search indexer or thumbnail readers hold a file for a moment: wait and try again
        static void Retry(Action action)
        {
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    action();
                    return;
                }
                catch (Exception error) when ((error is IOException || error is UnauthorizedAccessException) && !(error is FileNotFoundException) && attempt < 5)
                {
                    Thread.Sleep(150 * (attempt + 1));
                }
            }
        }

        public static string Friendly(Exception error, bool isDirectory)
        {
            if (error is FileNotFoundException || error is DirectoryNotFoundException) return "It no longer exists";
            if (isDirectory && (error is IOException || error is UnauthorizedAccessException))
                return "This folder is in use: a program, terminal or editor has it (or a file in it) open. Close that and try again.";
            if (error is UnauthorizedAccessException) return "Permission denied";
            if (error is IOException io && (io.HResult & 0xFFFF) == 32) return "It is in use by another program";
            if (error is IOException io2 && (io2.HResult & 0xFFFF) == 112) return "Not enough disk space";
            return error.Message;
        }

        /// <summary>Documents\DeskFence\&lt;name&gt;-&lt;id end&gt;: the real folder a fence keeps its files in.</summary>
        public static string FenceFolder(string name, string id)
        {
            string safe = string.Concat((name ?? "Fence").Split(Path.GetInvalidFileNameChars())).Trim().TrimEnd('.', ' ');
            if (safe.Length == 0) safe = "Fence";
            string suffix = new string((id ?? "").Replace("-", "").ToCharArray());
            if (suffix.Length > 6) suffix = suffix.Substring(suffix.Length - 6);
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "DeskFence", suffix.Length > 0 ? safe + "-" + suffix : safe);
            Directory.CreateDirectory(dir);
            return dir;
        }
    }
}
