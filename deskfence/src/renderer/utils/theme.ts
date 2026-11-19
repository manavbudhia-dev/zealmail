export type ThemeSetting = 'light' | 'dark' | 'auto';

let mediaQuery: MediaQueryList | null = null;
let mediaListener: (() => void) | null = null;

export function resolveTheme(theme: ThemeSetting | undefined): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

/** Sets <html data-theme="light|dark">; "auto" keeps following the OS setting. */
export function applyTheme(theme: ThemeSetting | undefined): 'light' | 'dark' {
  const root = document.documentElement;
  const resolved = resolveTheme(theme);
  root.dataset.theme = resolved;
  root.dataset.themeSetting = theme || 'auto';

  if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener);
  mediaQuery = null;
  mediaListener = null;

  if ((theme || 'auto') === 'auto' && window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    mediaListener = () => {
      root.dataset.theme = resolveTheme('auto');
    };
    mediaQuery.addEventListener('change', mediaListener);
  }
  return resolved;
}

export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Default look for newly created fences, matching the current theme. */
export function defaultFenceStyle(theme: 'light' | 'dark') {
  return theme === 'light'
    ? {
        backgroundColor: 'rgba(255, 255, 255, 0.88)',
        borderColor: '#3b82f6',
        borderWidth: 2,
        opacity: 0.95,
        labelColor: '#1f2937',
        labelSize: 14,
        borderRadius: 8,
      }
    : {
        backgroundColor: 'rgba(30, 41, 59, 0.85)',
        borderColor: '#3b82f6',
        borderWidth: 2,
        opacity: 0.95,
        labelColor: '#ffffff',
        labelSize: 14,
        borderRadius: 8,
      };
}
