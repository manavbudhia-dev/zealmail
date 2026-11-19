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

import type { FenceStyle } from '../../shared/types';

/**
 * Default look for new fences: a dark, slightly see-through panel with a thin light edge, a centered
 * white title and large icons. It reads well on light and dark wallpapers alike, so both themes use it.
 */
export function defaultFenceStyle(_theme?: 'light' | 'dark'): FenceStyle {
  return {
    backgroundColor: 'rgba(16, 20, 26, 0.86)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    opacity: 1,
    labelColor: '#ffffff',
    labelSize: 14,
    borderRadius: 6,
    iconPx: 34,
    itemLabelSize: 10,
  };
}

// The blue-bordered look earlier versions gave every new fence
const isOldDefault = (s: FenceStyle) =>
  s.borderColor === '#3b82f6' &&
  s.borderWidth === 2 &&
  s.borderRadius === 8 &&
  (s.backgroundColor === 'rgba(30, 41, 59, 0.85)' || s.backgroundColor === 'rgba(255, 255, 255, 0.88)');

/** How a fence is drawn: one still on the old default gets the current default (nothing is saved). */
export function displayStyle(style: FenceStyle): FenceStyle {
  if (!isOldDefault(style)) return style;
  return { ...defaultFenceStyle(), iconSize: style.iconSize, columns: style.columns, compactHeader: style.compactHeader };
}
