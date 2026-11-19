# DeskFence

Desktop organizer for Windows: fences on the Desktop, drawn with right-click + drag on empty Desktop space.

## Download the installer

Open `release/DeskFence-Setup.exe` in this folder on GitHub and click **Download raw file**.
It is not code-signed: if Windows SmartScreen warns, click **More info → Run anyway**.

## Build it yourself (Windows, Node.js 18+)

```bash
npm install
npm run package:win
```

The installer lands in `release/`.

## Develop

```bash
npm run dev
```
