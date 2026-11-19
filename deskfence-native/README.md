# DeskFence (native)

DeskFence rewritten as a native Windows app (C# / WPF, .NET 8). No Electron, no browser engine,
no PowerShell helper.

## Install

Download `release/DeskFence-Native-Setup.exe` (on GitHub: open it, then **Download raw file**) and run it.
It installs for your user only (no administrator rights), offers to remove the earlier Electron
DeskFence, and starts with Windows. Your fences carry over: both versions use `%APPDATA%\deskfence`.
Not code-signed: if SmartScreen warns, click **More info → Run anyway**.

## What is in this first native version

- Each fence is its own small window pinned to the Desktop: it never jumps above your apps or takes
  the focus when clicked
- Draw a fence: right-click and drag on empty Desktop space (or tray > New fence)
- Move, resize, rename (double-click the title), roll up, auto roll-up, lock, tabs, delete
- Drop files/folders on a fence to move them in (Ctrl = copy); drag them out anywhere, Windows
  handles the drop (Desktop, Explorer, another fence)
- Real Windows icons for files, folders and shortcuts; double-click opens
- Quick-hide: double-click empty Desktop space (fences and, optionally, Desktop icons)
- Peek: Win + Space shows the fences above your windows; Esc / Win + Space / a click goes back
- Fences showing a folder (from the earlier version) keep showing it, and follow it live
- Tray menu: new fence, hide/show, Peek, settings, start with Windows

Not yet ported (kept in your saved fences, coming next): automation rules, Organize my Desktop,
privacy mode, the customization panel, Folder Portal search / Details view.

## Build (Windows or Linux, .NET 8 SDK)

```bash
dotnet publish -c Release -o out
```

Installer (NSIS): `makensis -DEXE=out\DeskFence.exe -DOUT=DeskFence-Native-Setup.exe installer.nsi`
