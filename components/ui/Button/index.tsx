import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../Icon';
import { Spinner } from '../Spinner';
import { Tooltip } from '../Tooltip';
import { cx } from '../internal/utils';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading lucide icon (replaced by a spinner while `loading`). */
  iconBefore?: LucideIcon;
  /** Trailing lucide icon (e.g. ChevronDown for menu triggers). */
  iconAfter?: LucideIcon;
  /** Shows a spinner, keeps the label, sets aria-busy and ignores clicks (DS-02#AC6). */
  loading?: boolean;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

function buttonClass(variant: ButtonVariant, size: ButtonSize, fullWidth?: boolean, extra?: string) {
  return cx('pcp-button', `pcp-button--${variant}`, `pcp-button--${size}`, fullWidth && 'pcp-button--full', extra);
}

/** Verb-first, sentence-case labels ("Add person", "Sync now"). One primary button per region. */
export function Button({
  variant = 'secondary',
  size = 'md',
  iconBefore,
  iconAfter,
  loading = false,
  fullWidth,
  className,
  children,
  type = 'button',
  onClick,
  disabled,
  ref,
  ...rest
}: ButtonProps) {
  const iconSize = size === 'lg' ? 20 : 16;
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, fullWidth, cx(loading && 'pcp-button--loading', className))}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      disabled={disabled}
      onClick={handleClick}
      {...rest}
    >
      {loading ? (
        <Spinner size={iconSize === 20 ? 20 : 16} />
      ) : iconBefore ? (
        <Icon icon={iconBefore} size={iconSize} />
      ) : null}
      {children !== undefined && children !== null ? <span className="pcp-button__label">{children}</span> : null}
      {iconAfter ? <Icon icon={iconAfter} size={iconSize} className="pcp-button__after" /> : null}
    </button>
  );
}

export interface LinkButtonProps extends Omit<LinkProps, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconBefore?: LucideIcon;
  iconAfter?: LucideIcon;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

/** A router link that looks like a Button (navigation CTAs such as "Go to Home"). */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  iconBefore,
  iconAfter,
  fullWidth,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  const iconSize = size === 'lg' ? 20 : 16;
  return (
    <Link className={buttonClass(variant, size, fullWidth, className)} {...rest}>
      {iconBefore ? <Icon icon={iconBefore} size={iconSize} /> : null}
      <span className="pcp-button__label">{children}</span>
      {iconAfter ? <Icon icon={iconAfter} size={iconSize} className="pcp-button__after" /> : null}
    </Link>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Required accessible name; also shown as the tooltip. */
  label: string;
  variant?: Exclude<ButtonVariant, 'link'>;
  size?: ButtonSize;
  /** Hide the tooltip (e.g. when a visible label sits next to it). */
  noTooltip?: boolean;
  tooltipPlacement?: 'top' | 'bottom' | 'right' | 'left';
  /** Optional count badge (e.g. notifications). */
  badge?: number;
  ref?: Ref<HTMLButtonElement>;
}

/** Icon-only button: aria-label plus a Tooltip with the same text (DESIGN_SYSTEM §8.3). */
export function IconButton({
  icon,
  label,
  variant = 'subtle',
  size = 'md',
  noTooltip,
  tooltipPlacement = 'bottom',
  badge,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={badge ? `${label} (${badge > 99 ? '99+' : badge})` : label}
      className={cx('pcp-button', `pcp-button--${variant}`, `pcp-button--${size}`, 'pcp-button--icon', className)}
      {...rest}
    >
      <Icon icon={icon} size={size === 'lg' ? 20 : 16} />
      {badge ? (
        <span className="pcp-button__badge pcp-tnum" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
  if (noTooltip) return button;
  return (
    <Tooltip content={label} relation="label" placement={tooltipPlacement}>
      {button}
    </Tooltip>
  );
}

export interface ButtonGroupProps {
  children: ReactNode;
  /** Accessible name when the group has a meaning of its own. */
  label?: string;
  align?: 'start' | 'end';
  className?: string;
}

/** Horizontal set of buttons with an 8 px gap; never wraps (DESIGN_SYSTEM §8.2). */
export function ButtonGroup({ children, label, align = 'start', className }: ButtonGroupProps) {
  return (
    <div
      className={cx('pcp-button-group', align === 'end' && 'pcp-button-group--end', className)}
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}
