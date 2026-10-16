import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Renders children into document.body (overlays, menus, tooltips). */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
