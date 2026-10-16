import type { ReactNode } from 'react';
import { Funnel, Search, X } from 'lucide-react';
import { Icon } from '../Icon';
import { Button } from '../Button';
import { TextField } from '../TextField';
import { cx } from '../internal/utils';
import './filter-bar.css';

export interface FilterChipProps {
  /** e.g. "Chapter" */
  label: string;
  /** e.g. "Delivery" */
  value: string;
  onRemove: () => void;
}

/** Active filter shown as a removable chip: "Chapter: Delivery ×" (DESIGN_SYSTEM §8.9). */
export function FilterChip({ label, value, onRemove }: FilterChipProps) {
  return (
    <span className="pcp-filter-chip">
      <Icon icon={Funnel} size={12} />
      <span className="pcp-filter-chip__text">
        <span className="pcp-filter-chip__label">{label}:</span> {value}
      </span>
      <button type="button" className="pcp-filter-chip__remove" aria-label={`Remove filter ${label}: ${value}`} onClick={onRemove}>
        <Icon icon={X} size={12} />
      </button>
    </span>
  );
}

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** e.g. "Search people" (also the accessible name). */
  placeholder: string;
  width?: number;
  size?: 'sm' | 'md';
  className?: string;
}

/** Search input with leading Search icon and a clear button. */
export function SearchField({ value, onChange, placeholder, width = 240, size = 'md', className }: SearchFieldProps) {
  return (
    <div className={cx('pcp-search-field', className)} style={{ width }}>
      <TextField
        type="search"
        size={size}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        leadingIcon={Search}
        onChange={(e) => onChange(e.target.value)}
        onClear={() => onChange('')}
      />
    </div>
  );
}

export interface FilterBarProps {
  /** Search field (SearchField) on the left. */
  search?: ReactNode;
  /** Filter controls (Selects, Menus) after the search. */
  filters?: ReactNode;
  /** Active filter chips (FilterChip). */
  chips?: ReactNode;
  /** Shows "Clear all" when chips exist. */
  onClearAll?: () => void;
  /** Right-aligned controls (group by, view toggles). */
  end?: ReactNode;
  className?: string;
}

/** Row of search, filters and chips; use as DataTable `toolbar` or above a grid/chart. */
export function FilterBar({ search, filters, chips, onClearAll, end, className }: FilterBarProps) {
  const hasChips = Array.isArray(chips) ? chips.length > 0 : !!chips;
  return (
    <div className={cx('pcp-filter-bar', className)}>
      <div className="pcp-filter-bar__start">
        {search}
        {filters}
        {hasChips ? <div className="pcp-filter-bar__chips">{chips}</div> : null}
        {hasChips && onClearAll ? (
          <Button variant="link" onClick={onClearAll}>
            Clear all
          </Button>
        ) : null}
      </div>
      {end ? <div className="pcp-filter-bar__end">{end}</div> : null}
    </div>
  );
}
