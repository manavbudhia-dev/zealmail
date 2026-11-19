/**
 * The desktop window is full-screen and transparent. The main process asks this
 * function (about 15x/second) "is there something clickable under the cursor?".
 * If not, it makes the window click-through so the rest of the PC keeps working.
 *
 * "Background" = the page itself or any element marked data-clickthrough="true"
 * (the full-screen wrapper in App.tsx). Everything else (fences, dialogs, menus,
 * buttons) is interactive.
 */
let pressed = false;
let lastMouseActivity = 0;
// If the button-up is never seen (released outside the window, window lost focus...) the flag
// must not keep the whole screen captured. Real drags keep refreshing it with mouse moves.
const PRESSED_TTL_MS = 8000;

/** True while a mouse button is held (used to postpone UI refreshes during a drag). */
export function isMousePressed(): boolean {
  return pressed && Date.now() - lastMouseActivity < PRESSED_TTL_MS;
}

export function installClickThroughHitTest(): void {
  // While a mouse button is held (dragging or resizing a fence) keep capturing,
  // otherwise a fast drag that outruns the fence would drop the mouse mid-drag.
  window.addEventListener('mousedown', () => { pressed = true; lastMouseActivity = Date.now(); }, true);
  window.addEventListener('mousemove', (e) => {
    if (!pressed) return;
    if (e.buttons === 0) pressed = false; // the button was released somewhere we did not see
    else lastMouseActivity = Date.now();
  }, true);
  window.addEventListener('mouseup', () => { pressed = false; }, true);
  window.addEventListener('blur', () => { pressed = false; });
  window.addEventListener('dragend', () => { pressed = false; }, true);
  // An HTML5 drag (a fence item) sends no mouse events, so keep the window capturing for as long as
  // the drag lasts: dragover repeats while the pointer is over this window.
  window.addEventListener('dragstart', () => { pressed = true; lastMouseActivity = Date.now(); }, true);
  window.addEventListener('dragover', () => { if (pressed) lastMouseActivity = Date.now(); }, true);
  window.addEventListener('drop', () => { pressed = false; }, true);

  (window as any).__deskfenceHitTest = (x: number, y: number): boolean => {
    if (isMousePressed()) return true;
    pressed = false;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (el.id === 'root' || el.dataset.clickthrough === 'true') return false;
    return true;
  };
}
