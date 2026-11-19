// Finds the user's own shortcuts / folders by name, so a layout preset can be filled with the apps that are
// really installed on this PC. Pure file-system code (no Electron) so it can be tested.
const fs = require('fs');
const path = require('path');

const MAX_CANDIDATES = 6000;
const SKIP_START_MENU = /\b(uninstall|uninstaller|readme|release notes|license|documentation|manual|help|website|support|repair)\b/;

const normalize = (text) =>
  String(text)
    .toLowerCase()
    .replace(/\.(lnk|url|exe)$/, '')
    .replace(/\s*-\s*shortcut$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * roots: [{ dir, source, depth, dirs, files, exts }]
 *   source  'desktop' | 'start' | 'docs'  (desktop wins ties: it is what the user arranged themselves)
 *   depth   how many folder levels to look into (1 = only the folder itself)
 *   dirs    include sub-folders as candidates;  files: include files (limited to `exts` when given)
 */
function collectCandidates(roots) {
  const found = [];
  const seenPaths = new Set();

  const visit = (dir, root, level) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return; // missing / no access: that source simply has nothing to offer
    }
    for (const entry of entries) {
      if (found.length >= MAX_CANDIDATES) return;
      if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'desktop.ini') continue;
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try { isDir = fs.statSync(full).isDirectory(); } catch (_) { continue; }
      }
      if (isDir) {
        if (root.dirs && !seenPaths.has(full.toLowerCase())) {
          seenPaths.add(full.toLowerCase());
          found.push({ name: entry.name, norm: normalize(entry.name), path: full, isDir: true, source: root.source });
        }
        if (level < root.depth) visit(full, root, level + 1);
      } else if (root.files) {
        const ext = path.extname(entry.name).toLowerCase();
        if (root.exts && !root.exts.includes(ext)) continue;
        if (root.source === 'start' && SKIP_START_MENU.test(normalize(entry.name))) continue;
        if (seenPaths.has(full.toLowerCase())) continue;
        seenPaths.add(full.toLowerCase());
        found.push({ name: entry.name, norm: normalize(entry.name), path: full, isDir: false, source: root.source });
      }
    }
  };

  for (const root of roots) visit(root.dir, root, 1);
  return found;
}

const SOURCE_BONUS = { desktop: 6, docs: 4, start: 3 };

/** How well a candidate name matches one wanted name (0 = not at all). */
function matchScore(candidateNorm, wantedNorm) {
  if (!wantedNorm || !candidateNorm) return 0;
  if (candidateNorm === wantedNorm) return 100;
  if (candidateNorm.startsWith(wantedNorm + ' ')) return 70; // "google chrome canary" for "google chrome"
  if (candidateNorm.endsWith(' ' + wantedNorm)) return 62; // "flashcard project files" for "project files"
  if ((' ' + candidateNorm + ' ').includes(' ' + wantedNorm + ' ')) return 55; // whole words inside
  if (wantedNorm.length >= 5 && candidateNorm.includes(wantedNorm)) return 40; // "brave com" for "brave"
  return 0;
}

/**
 * requests: [{ key, names: [...], kind: 'app' | 'folder' }]
 * returns:  { [key]: { path, name, source } | null }
 */
function findMatches(requests, roots) {
  const candidates = collectCandidates(roots);
  const result = {};
  for (const request of requests) {
    const wanted = (request.names || []).map(normalize).filter(Boolean);
    let best = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      if ((request.kind === 'folder') !== candidate.isDir) continue;
      let score = 0;
      for (const alias of wanted) score = Math.max(score, matchScore(candidate.norm, alias));
      if (score === 0) continue;
      score += SOURCE_BONUS[candidate.source] || 0;
      score -= candidate.norm.length * 0.05; // among equals prefer the plainer name
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    result[request.key] = best ? { path: best.path, name: best.name, source: best.source } : null;
  }
  return result;
}

/**
 * Which file's icon to draw for a shortcut: the program it starts (clean icon, no little arrow),
 * or the .ico the shortcut itself names. `link` comes from Electron's shell.readShortcutLink.
 */
function pickIconSource(shortcutPath, link, exists = fs.existsSync) {
  if (!/\.lnk$/i.test(shortcutPath) || !link) return shortcutPath;
  if (link.icon && /\.ico$/i.test(link.icon) && exists(link.icon)) return link.icon;
  if (link.target && exists(link.target)) return link.target;
  return shortcutPath;
}

module.exports = { normalize, collectCandidates, matchScore, findMatches, pickIconSource };
