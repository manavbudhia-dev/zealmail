using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace DeskFence
{
    /// <summary>
    /// The real Windows icon of a file, folder or shortcut (what Explorer shows), loaded on one
    /// background thread and cached. Folders get their real folder icon, shortcuts the icon of the
    /// program they start.
    /// </summary>
    internal static class ShellIcons
    {
        static readonly ConcurrentDictionary<string, ImageSource> Cache = new ConcurrentDictionary<string, ImageSource>(StringComparer.OrdinalIgnoreCase);
        static readonly BlockingCollection<(string Path, int Size, Action<ImageSource> Done, Dispatcher Ui)> Queue =
            new BlockingCollection<(string, int, Action<ImageSource>, Dispatcher)>();
        static Thread worker;

        public static void Request(string path, int size, Action<ImageSource> done)
        {
            if (string.IsNullOrEmpty(path)) return;
            string key = path + "|" + size;
            if (Cache.TryGetValue(key, out var cached))
            {
                done(cached);
                return;
            }
            EnsureWorker();
            Queue.Add((path, size, done, Dispatcher.CurrentDispatcher));
        }

        public static void Forget(string path)
        {
            foreach (var key in Cache.Keys)
                if (key.StartsWith(path + "|", StringComparison.OrdinalIgnoreCase)) Cache.TryRemove(key, out _);
        }

        static void EnsureWorker()
        {
            if (worker != null) return;
            worker = new Thread(() =>
            {
                foreach (var job in Queue.GetConsumingEnumerable())
                {
                    string key = job.Path + "|" + job.Size;
                    ImageSource image = null;
                    try
                    {
                        if (!Cache.TryGetValue(key, out image))
                        {
                            image = Load(job.Path, job.Size);
                            if (image != null) Cache[key] = image;
                        }
                    }
                    catch (Exception error)
                    {
                        Log.Error("Icon for " + job.Path, error);
                    }
                    if (image != null)
                    {
                        var img = image;
                        job.Ui.BeginInvoke(() => job.Done(img));
                    }
                }
            })
            { IsBackground = true, Name = "Icons" };
            worker.SetApartmentState(ApartmentState.STA); // shell objects want an STA thread
            worker.Start();
        }

        // ---- IShellItemImageFactory: the icon Explorer itself would draw, at any size ----
        [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItemImageFactory
        {
            [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
        }

        [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);

        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
        [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, ref BITMAP bm);
        [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint lines, byte[] bits, ref BITMAPINFOHEADER bmi, uint usage);
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);

        [StructLayout(LayoutKind.Sequential)]
        struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }

        [StructLayout(LayoutKind.Sequential)]
        struct BITMAPINFOHEADER
        {
            public int biSize, biWidth, biHeight;
            public ushort biPlanes, biBitCount;
            public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
        }

        static ImageSource Load(string path, int size)
        {
            if (!File.Exists(path) && !Directory.Exists(path) && !path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)) return null;
            var iid = typeof(IShellItemImageFactory).GUID;
            if (SHCreateItemFromParsingName(path, IntPtr.Zero, iid, out IntPtr ptr) != 0 || ptr == IntPtr.Zero) return null;
            try
            {
                var factory = (IShellItemImageFactory)Marshal.GetObjectForIUnknown(ptr);
                // SIIGBF_ICONONLY (no thumbnails: they are slow and not what the Desktop shows) | BIGGERSIZEOK
                if (factory.GetImage(new SIZE { cx = size, cy = size }, 0x4 | 0x1, out IntPtr hbm) != 0 || hbm == IntPtr.Zero) return null;
                try
                {
                    return FromHBitmap(hbm);
                }
                finally
                {
                    DeleteObject(hbm);
                    Marshal.ReleaseComObject(factory);
                }
            }
            finally
            {
                Marshal.Release(ptr);
            }
        }

        // CreateBitmapSourceFromHBitmap drops the alpha channel (black corners); read the 32-bit pixels instead
        static BitmapSource FromHBitmap(IntPtr hbm)
        {
            var bm = new BITMAP();
            GetObject(hbm, Marshal.SizeOf<BITMAP>(), ref bm);
            int w = bm.bmWidth, h = Math.Abs(bm.bmHeight);
            if (w <= 0 || h <= 0) return null;
            var header = new BITMAPINFOHEADER { biSize = Marshal.SizeOf<BITMAPINFOHEADER>(), biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
            var pixels = new byte[w * h * 4];
            IntPtr dc = GetDC(IntPtr.Zero);
            try
            {
                if (GetDIBits(dc, hbm, 0, (uint)h, pixels, ref header, 0) == 0) return null;
            }
            finally
            {
                ReleaseDC(IntPtr.Zero, dc);
            }
            bool anyAlpha = false;
            for (int i = 3; i < pixels.Length; i += 4)
                if (pixels[i] != 0) { anyAlpha = true; break; }
            if (!anyAlpha)
                for (int i = 3; i < pixels.Length; i += 4) pixels[i] = 255; // an old icon without alpha: fully opaque
            var source = BitmapSource.Create(w, h, 96, 96, PixelFormats.Pbgra32, null, pixels, w * 4);
            source.Freeze();
            return source;
        }

        /// <summary>A "data:image/png;base64,..." icon stored with an item (layout presets).</summary>
        public static ImageSource FromDataUrl(string dataUrl)
        {
            try
            {
                int comma = dataUrl.IndexOf(',');
                if (comma < 0) return null;
                var bytes = Convert.FromBase64String(dataUrl.Substring(comma + 1));
                var image = new BitmapImage();
                image.BeginInit();
                image.CacheOption = BitmapCacheOption.OnLoad;
                image.StreamSource = new MemoryStream(bytes);
                image.EndInit();
                image.Freeze();
                return image;
            }
            catch
            {
                return null;
            }
        }
    }
}
