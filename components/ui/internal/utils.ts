import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref, type RefCallback } from 'react';

/** Joins class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Merges several refs into one callback ref. */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (value: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(value);
      else (ref as { current: T | null }).current = value;
    }
  };
}

export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Reads/writes a UI preference in localStorage under `pcp.ui.*` (DESIGN_SYSTEM §14: preferences only). */
export function readUiPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`pcp.ui.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeUiPref<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(`pcp.ui.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota): preferences are optional */
  }
}

/** useState backed by a `pcp.ui.*` localStorage preference. */
export function useUiPref<T>(key: string | null | undefined, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => (key ? readUiPref(key, fallback) : fallback));
  const set = useCallback(
    (v: T) => {
      setValue(v);
      if (key) writeUiPref(key, v);
    },
    [key],
  );
  return [value, set];
}

/** Controlled/uncontrolled state helper. */
export function useControllable<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (v: T) => void,
): [T, (v: T) => void] {
  const [inner, setInner] = useState<T>(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? (value as T) : inner;
  const set = useCallback(
    (v: T) => {
      if (!isControlled) setInner(v);
      onChange?.(v);
    },
    [isControlled, onChange],
  );
  return [current, set];
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null,
  );
}

/**
 * Traps Tab focus inside `ref` while `active`, moves initial focus (to `[data-autofocus]`, else the first
 * focusable, else the container) and restores focus to the previously focused element on deactivate.
 */
export function useFocusTrap(ref: { current: HTMLElement | null }, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const initial =
      root.querySelector<HTMLElement>('[data-autofocus]') ?? focusableWithin(root)[0] ?? (root as HTMLElement);
    // Defer so the element is laid out (animations start at opacity 0 but stay focusable).
    const t = window.setTimeout(() => initial.focus({ preventScroll: true }), 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusableWithin(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || !root.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !root.contains(activeEl))) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(t);
      root.removeEventListener('keydown', onKeyDown);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [ref, active]);
}

let scrollLocks = 0;
/** Locks page scroll while a modal surface is open (reference-counted). */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    scrollLocks += 1;
    const html = document.documentElement;
    if (scrollLocks === 1) html.classList.add('pcp-scroll-locked');
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) html.classList.remove('pcp-scroll-locked');
    };
  }, [active]);
}

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'top' | 'bottom' | 'right' | 'left';

/**
 * Positions a fixed floating element next to an anchor (menus, listboxes, tooltips). Flips vertically
 * when there is not enough room and keeps the element inside the viewport. Returns inline geometry only.
 */
export function useAnchoredPosition(
  open: boolean,
  anchor: { current: HTMLElement | null },
  floating: { current: HTMLElement | null },
  placement: Placement = 'bottom-start',
  offset = 4,
): { top: number; left: number; minWidth?: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number; minWidth?: number } | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    let frame: number | null = null;
    const compute = () => {
      const a = anchor.current;
      const f = floating.current;
      if (!a || !f) return;
      const r = a.getBoundingClientRect();
      const fw = f.offsetWidth;
      const fh = f.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;
      let top = 0;
      let left = 0;
      const [side, align] = placement.split('-');
      if (side === 'right' || side === 'left') {
        top = r.top + r.height / 2 - fh / 2;
        left = side === 'right' ? r.right + offset : r.left - fw - offset;
        if (side === 'right' && left + fw > vw - margin) left = r.left - fw - offset;
      } else {
        const below = r.bottom + offset;
        const above = r.top - offset - fh;
        if (side === 'top') top = above >= margin ? above : below;
        else top = below + fh <= vh - margin || above < margin ? below : above;
        if (align === 'start') left = r.left;
        else if (align === 'end') left = r.right - fw;
        else left = r.left + r.width / 2 - fw / 2;
      }
      left = Math.min(Math.max(margin, left), Math.max(margin, vw - fw - margin));
      top = Math.min(Math.max(margin, top), Math.max(margin, vh - fh - margin));
      setPos((p) =>
        p && p.top === top && p.left === left && p.minWidth === r.width ? p : { top, left, minWidth: r.width },
      );
    };
    compute();
    const onChange = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [open, anchor, floating, placement, offset]);

  return pos;
}

/** Calls `handler` on pointer-down outside every given element while `active`. */
export function useOutsideClick(
  refs: Array<{ current: HTMLElement | null }>,
  active: boolean,
  handler: () => void,
): void {
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (refs.some((r) => r.current && r.current.contains(target))) return;
      saved.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // refs is a stable array of ref objects created by the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
