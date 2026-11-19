using System;
using System.Linq;

namespace DeskFence
{
    /// <summary>
    /// Fence positions are saved like the earlier version did: in device-independent pixels, relative
    /// to the work area of a monitor (and that monitor's device name). This converts them to and from
    /// real screen pixels, so fences stay put on monitors with different scaling.
    /// </summary>
    internal static class Screens
    {
        public static Native.Monitor ByDevice(string device)
        {
            var all = Native.Monitors();
            return all.FirstOrDefault(m => !string.IsNullOrEmpty(device) && string.Equals(m.Device, device, StringComparison.OrdinalIgnoreCase))
                ?? all.FirstOrDefault(m => m.Primary)
                ?? all.FirstOrDefault();
        }

        /// <summary>Saved (DIP, relative to the work area) -> screen pixels, kept on that monitor.</summary>
        public static (int X, int Y, Native.Monitor Monitor) ToScreen(double x, double y, double widthDip, string device)
        {
            var m = ByDevice(device);
            if (m == null) return ((int)x, (int)y, null);
            int px = m.Work.Left + (int)Math.Round(x * m.Scale);
            int py = m.Work.Top + (int)Math.Round(y * m.Scale);
            // never place a fence where it cannot be reached (monitor changed, resolution lowered)
            int maxX = m.Work.Right - (int)Math.Round(Math.Min(widthDip, 200) * m.Scale);
            int maxY = m.Work.Bottom - (int)Math.Round(30 * m.Scale);
            px = Math.Clamp(px, m.Work.Left, Math.Max(m.Work.Left, maxX));
            py = Math.Clamp(py, m.Work.Top, Math.Max(m.Work.Top, maxY));
            return (px, py, m);
        }

        /// <summary>Screen pixels (window's top-left) -> saved form on the monitor holding the window's centre.</summary>
        public static (double X, double Y, string Device) FromScreen(Native.RECT rect)
        {
            var center = new Native.POINT { X = (rect.Left + rect.Right) / 2, Y = (rect.Top + rect.Bottom) / 2 };
            var m = Native.MonitorAt(center);
            double x = (rect.Left - m.Work.Left) / m.Scale;
            double y = (rect.Top - m.Work.Top) / m.Scale;
            return (Math.Max(0, x), Math.Max(0, y), m.Device);
        }
    }
}
