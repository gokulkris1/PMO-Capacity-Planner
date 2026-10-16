import { useState } from 'react';
import { cx } from '../internal/utils';
import './avatar.css';

export type AvatarSize = 24 | 28 | 32 | 40;

export interface AvatarProps {
  name: string;
  /** Image URL (e.g. Atlassian avatar when linked); falls back to initials on error. */
  src?: string | null;
  size?: AvatarSize;
  /** Small info dot meaning "linked to Jira" (text equivalent must exist elsewhere). */
  linked?: boolean;
  /** Decorative avatars next to a visible name are hidden from assistive tech. */
  decorative?: boolean;
  className?: string;
}

/** First + last initial, uppercase. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Initials on primary-subtle, or the image; no status colours (DESIGN_SYSTEM §8.18). */
export function Avatar({ name, src, size = 32, linked, decorative = true, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;
  return (
    <span
      className={cx('pcp-avatar', `pcp-avatar--${size}`, className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
    >
      {showImage ? (
        <img src={src ?? undefined} alt="" className="pcp-avatar__img" onError={() => setFailed(true)} />
      ) : (
        <span className="pcp-avatar__initials">{initials(name)}</span>
      )}
      {linked ? <span className="pcp-avatar__dot" /> : null}
    </span>
  );
}
