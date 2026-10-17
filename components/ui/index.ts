/**
 * components/ui — the PMO Capacity Planner primitives kit (DS-02…DS-04, DESIGN_SYSTEM §8).
 * Usage guide: components/ui/README.md. Charts live in 'components/ui/charts' (separate entry so Recharts
 * loads only on pages that draw charts).
 */
export { Icon, type IconProps, type IconSize } from './Icon';
export { Spinner, type SpinnerProps } from './Spinner';
export { Tooltip, type TooltipProps } from './Tooltip';
export {
  Button,
  LinkButton,
  IconButton,
  ButtonGroup,
  type ButtonProps,
  type LinkButtonProps,
  type IconButtonProps,
  type ButtonGroupProps,
  type ButtonVariant,
  type ButtonSize,
} from './Button';
export { FormField, Fieldset, useFieldControl, type FormFieldProps } from './FormField';
export {
  TextField,
  TextField as Input,
  DateField,
  DateField as DateInput,
  Textarea,
  PasswordField,
  type PasswordFieldProps,
  type TextFieldProps,
  type DateFieldProps,
  type TextareaProps,
} from './TextField';
export { NumberField, NumberField as NumberInput, type NumberFieldProps } from './NumberField';
export { Select, type SelectProps, type SelectOption } from './Select';
export { Combobox, type ComboboxProps, type ComboboxOption } from './Combobox';
export { QuarterPicker, type QuarterPickerProps } from './QuarterPicker';
export { CodeInput, type CodeInputProps } from './CodeInput';
export {
  Checkbox,
  Switch,
  RadioGroup,
  type CheckboxProps,
  type SwitchProps,
  type RadioGroupProps,
  type RadioOption,
} from './Checkbox';
export {
  Tabs,
  TabPanel,
  useTabParam,
  SegmentedControl,
  type TabsProps,
  type TabItem,
  type SegmentedControlProps,
  type SegmentOption,
} from './Tabs';
export {
  StatusPill,
  BandPill,
  BandValue,
  BAND_ICON,
  CraftChip,
  ProvenanceTag,
  Tag,
  Badge,
  Kbd,
  BandCell,
  BookingStatePill,
  type StatusTone,
  type StatusPillProps,
  type BandPillProps,
  type BandValueProps,
  type CraftChipProps,
  type ProvenanceSource,
  type TagProps,
  type BadgeProps,
} from './StatusPill';
export { Avatar, PersonLabel, initials, type AvatarProps, type AvatarSize } from './Avatar';
export { Card, Panel, type CardProps } from './Card';
export { KpiTile, KpiGrid, type KpiTileProps, type KpiDelta } from './KpiTile';
export { EmptyState, FilteredEmptyState, type EmptyStateProps } from './EmptyState';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { Banner, type BannerProps, type BannerTone } from './Banner';
export { Menu, Popover, type MenuProps, type MenuItem } from './Menu';
export { PageHeader, Breadcrumbs, type PageHeaderProps, type Crumb } from './PageHeader';
export {
  Dialog,
  Modal,
  ConfirmDialog,
  ConfirmProvider,
  useConfirm,
  type DialogProps,
  type ConfirmDialogProps,
  type ConfirmOptions,
} from './Dialog';
export { Drawer, type DrawerProps } from './Drawer';
export { ToastProvider, useToast, errorToastText, type ToastApi, type ToastOptions, type ToastTone } from './Toast';
export {
  QuarterLoadBar,
  HeatStrip,
  relativeLoadSplit,
  type QuarterLoadBarProps,
  type HeatStripCell,
} from './QuarterLoadBar';
export {
  DataTable,
  CellButton,
  applySort,
  toCsvMatrix,
  type DataTableProps,
  type Column,
  type SortState,
  type SortDirection,
  type Density,
  type CellButtonProps,
} from './DataTable';
export {
  FilterBar,
  FilterChip,
  SearchField,
  type FilterBarProps,
  type FilterChipProps,
  type SearchFieldProps,
} from './FilterBar';
export {
  useDocumentTitle,
  useUrlParam,
  useQueryParam,
  useElementWidth,
  useMediaQuery,
  formatPct,
  formatFte,
  formatDate,
  PRODUCT_NAME,
} from './hooks';
export { useAction, type ActionOptions } from './useAction';
export { useSort, SortTh, TableScroll, type TableSort } from './Table';
export * as fmt from './format';
export { indexSnapshot, toCsv, downloadText, errorMessage, numOrNull, numText, type SnapshotIndex } from './format';
/** Lightweight charts (no Recharts). The Recharts kit stays in 'components/ui/charts'. */
export {
  ChartPanel,
  Legend,
  StackedBarChart,
  GroupedBarChart,
  TrendChart,
  niceScale,
  type SwatchKind,
  type StackColumn,
  type StackSegment,
} from './charts/lite';
export { cx } from './internal/utils';
