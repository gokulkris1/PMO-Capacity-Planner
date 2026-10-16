import type { LucideIcon } from 'lucide-react';
import { cx } from '../internal/utils';
import './icon.css';

export type IconSize = 12 | 14 | 16 | 20 | 24 | 32;

export interface IconProps {
  /** A lucide-react icon component, e.g. `Users` (DESIGN_SYSTEM §10). */
  icon: LucideIcon;
  /** 16 in nav, tables, buttons and menus; 20 in page headers; 12 in chips; 32 in empty states. */
  size?: IconSize;
  /** Accessible name. Omit for decorative icons next to text (rendered `aria-hidden`). */
  label?: string;
  className?: string;
}

/** Lucide icon with the design-system stroke (1.75; 1.5 at 32 px) and `currentColor`. */
export function Icon({ icon: Glyph, size = 16, label, className }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={size >= 32 ? 1.5 : 1.75}
      className={cx('pcp-icon', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
