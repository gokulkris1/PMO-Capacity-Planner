# components/ui — PMO Capacity Planner kit (Release 2.0)

Owner: **B1**. Spec: `docs/product/DESIGN_SYSTEM.md` (§8 components, §10 icons, §11 charts, §12 a11y).
Live reference (dev builds only): **`/o/demo/w/demo/kit`** (`pages/system/KitGallery.tsx`).

```ts
import { Button, DataTable, PageHeader, useToast } from '../../components/ui';      // primitives
import { StackedCapacityChart, TrendLine, ChartFrame } from '../../components/ui/charts'; // Recharts (lazy vendor chunk)
import { useWsPath, useTimeBasis, TimeBasisControl, RequirePermission } from '../../components/shell';
```

Rules (lint + `npm run check:guardrails` enforce them): tokens only (`var(--…)`), no hex, no inline colour
styles (geometry such as `width`/`height`/`gridTemplateColumns` is fine), no `alert/confirm/prompt`, no emoji,
icons from `lucide-react` only (names in DESIGN_SYSTEM §10). Page layout uses the utility classes in
`styles/utilities.css` (`pcp-page`, `pcp-stack`, `pcp-row`, `pcp-grid` + `pcp-col-12` / `pcp-col-lg-{3..9}`,
`pcp-tnum`, `pcp-num`, `pcp-truncate`, `pcp-sr-only`, `pcp-caption`, `pcp-text-secondary`, `pcp-dl`, …).

## Page skeleton

```tsx
export default function PeoplePage() {
  const basis = useTimeBasis('qbr1');                    // ?basis=today|qbr1..4|window
  const to = useWsPath();                                // to('org/people?person=r1')
  const [personId, setPersonId] = useUrlParam('person'); // drawer in the URL (Back closes it)
  return (
    <>
      <PageHeader
        title="People"                                    // also sets document.title "People · PMO Capacity Planner"
        breadcrumbs={[{ label: 'Organisation' }, { label: 'People' }]}
        description="Who is in the squad, their crafts and load for the next four quarters."
        actions={<Button variant="primary" iconBefore={Plus}>Add person</Button>}
        overflow={[{ id: 'csv', label: 'Export CSV', icon: Download, onSelect: exportCsv }]}
        timeBasis={<TimeBasisControl state={basis} />}
      />
      <div className="pcp-page pcp-stack">…</div>
    </>
  );
}
```

## Exports and props

### Actions
| Export | Props (besides native button props) |
|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'subtle'\|'danger'\|'link'` (default secondary), `size: 'sm'\|'md'\|'lg'`, `iconBefore`, `iconAfter` (LucideIcon), `loading`, `fullWidth`, `ref` |
| `LinkButton` | router `Link` styled as Button: `to`, `variant`, `size`, `iconBefore`, `iconAfter` |
| `IconButton` | `icon`, **`label`** (aria-label + tooltip), `variant` (default subtle), `size`, `badge?: number`, `noTooltip`, `tooltipPlacement` |
| `ButtonGroup` | `children`, `label?` (role=group), `align: 'start'\|'end'` |
| `Menu` | `trigger: ReactElement` (Button/IconButton), `items: MenuItem[]`, `label?`, `placement`, `minWidth`. `MenuItem = { id, label, icon?, onSelect?, to?, href?, danger?, disabled?, shortcut?, description?, selected? } \| { type:'separator', id } \| { type:'header', id, label, description? }` |
| `Popover` | `trigger`, `label`, `open`, `onOpenChange`, `width`, `placement`, `children` (free content in menu chrome) |

### Forms (wrap controls in `FormField` — label `for`/`id`, `aria-describedby`, `aria-invalid` are wired automatically)
| Export | Props |
|---|---|
| `FormField` | `label`, `children`, `help?`, `error?`, `optional?` ("(optional)"), `required?`, `id?`, `hideLabel?`, `labelAside?` |
| `Fieldset` | `legend`, `description?`, `children` |
| `TextField` (= `Input`) | native input props + `size`, `leadingIcon?`, `onClear?` (clear button), `invalid?` |
| `NumberField` (= `NumberInput`) | `value: number\|null`, `onChange`, `min`, `max`, `step` (1 for %, 0.1 for FTE), `unit` ("%", "FTE"), `decimals?`, `size`. Arrow keys step; out-of-range shows "Enter 0–200" on blur |
| `Select` | native select props + `options?: {value,label,disabled?}[]`, `placeholder?`, `size`, `invalid?` |
| `Combobox` | `options: {value,label,description?,leading?,group?,disabled?}[]`, `value`, `onChange(value\|null)`, `placeholder`, `clearable`, `size`, `emptyText` (people/projects/crafts pickers) |
| `DateField` (= `DateInput`) | TextField props, `value` ISO `YYYY-MM-DD` |
| `QuarterPicker` | `quarters` (from `useQuarters()`), `value` (quarter key or `'window'`), `onChange`, `includeWindow`, `fiscal` |
| `Textarea` | native textarea props + `invalid?` |
| `Checkbox` | `checked`, `onChange(bool)`, `label?`, `description?`, `indeterminate?`, `disabled?`, `aria-label?` |
| `Switch` | `checked`, `onChange(bool)`, `label`, `description?`, `disabled?`, `hideLabel?` (role=switch) |
| `RadioGroup` | `label`, `value`, `onChange`, `options: {value,label,description?,disabled?}[]`, `orientation` |
| `CodeInput` | `value`, `onChange`, `onComplete?`, `length=6`, `label`, `invalid?`, `autoFocus?` (OTP boxes, paste supported) |
| `SearchField` | `value`, `onChange`, `placeholder` (= accessible name), `width`, `size` |

### Navigation and layout
| Export | Props |
|---|---|
| `PageHeader` | `title`, `breadcrumbs?: {label,to?}[]`, `description?` (one line, tooltip), `actions?`, `overflow?: MenuItem[]` (Ellipsis "More actions"), `timeBasis?: ReactNode`, `tabs?: ReactNode`, `setTitle` (default true) |
| `Breadcrumbs` | `items: Crumb[]` |
| `Tabs` | `tabs: {id,label,count?,disabled?}[]`, `value`, `onChange`, **`label`**, `idBase?` (+ `TabPanel { idBase, tabId }`). `useTabParam(allowed, fallback)` keeps `?tab=` |
| `SegmentedControl` | `options: {value,label,icon?,title?}[]`, `value`, `onChange`, **`label`**, `size: 'sm'\|'md'`, `iconOnly?` |
| `Card` (= `Panel`) | `title?`, `subtitle?` (time basis), `actions?`, `dense?`, `flush?` (no body padding), `footer?`, `headingLevel` |
| `KpiTile` | `label`, `value`, **`caption`** (time basis), `band?`, `delta?: {direction:'up'\|'down'\|'flat', text}`, `sparkline?: number[]`, `onHelp?` |
| `KpiGrid` | 4 / 2 / 1 per row; supply 4 or 8 tiles |
| `FilterBar` | `search?`, `filters?`, `chips?` (FilterChip[]), `onClearAll?`, `end?` — use as DataTable `toolbar` |
| `FilterChip` | `label`, `value`, `onRemove` |

### Data display
| Export | Props |
|---|---|
| `DataTable<T>` | **`id`** (persists density/columns), **`caption`**, `columns: Column<T>[]`, `rows`, `getRowId`, `status: 'ready'\|'loading'\|'error'`, `onRetry`, `errorMessage`, `empty` (EmptyState node), `defaultDensity`, `densityToggle`, `columnToggle`, `sort`/`onSortChange`/`defaultSort`, `selectable` + `selectedIds` + `onSelectionChange` + `bulkActions(ids)`, `toolbar`, `toolbarEnd`, `maxHeight`, `groupBy(row) → {id,label}`, `activeRowId`, `virtualize: 'auto'` (> 200 rows), `stickyFirstColumn` |
| `Column<T>` | `{ id, header, headerText?, cell(row), sortValue?(row), csvValue?(row), align?: 'left'\|'right'\|'center', width?, hideable?, defaultHidden?, flush?, groupCell?(rows, groupId) }` |
| `CellButton` | row-header button that opens a drawer: `children`, `onClick`, `sublabel?`, `leading?` (Avatar 24) |
| `applySort`, `toCsvMatrix` | current view → `string[][]` for C's `toCsv()` (DS-04#AC7) |
| `StatusPill` | `tone: 'neutral'\|'info'\|'success'\|'warning'\|'danger'\|'brand'`, `icon?`, children (rendered uppercase) |
| `BandPill` | `band: UtilBand`, `value?` ("112% · Over capacity"), `label?` |
| `BandValue` | table cell tint: `band`, `pct`, `context?` (aria), `fill?` |
| `CraftChip` | `craft: {short,name}` (a `CraftDTO`), `via: 'primary'\|'secondary'`, `proficiency?`, `maxPct?`, `undeclared?` |
| `ProvenanceTag` | `source: 'manual'\|'marketplace'\|'jira'\|'planview'` |
| `Tag` | skills: `children`, `onRemove?` |
| `Badge` | `count`, `tone: 'danger'\|'brand'\|'neutral'`, `label?` |
| `Avatar` | `name`, `src?`, `size: 24\|28\|32\|40`, `linked?`, `decorative` (default true) |
| `QuarterLoadBar` | `quarterLabel`, `above`, `below`, `undeclared`, `free` (all % of target, from `PersonRow.quarters[i]`), `target?`, `size: 'sm'\|'md'`, `showLabel` |
| `HeatStrip` | `cells: {label,pct,band,detail?}[]`, `label?` |
| `Kbd`, `Icon` (`icon`, `size`, `label?`), `Spinner`, `Tooltip` (`content`, one focusable child, `placement`) |

### Feedback and overlays
| Export | Props |
|---|---|
| `Banner` | `tone: 'info'\|'success'\|'warning'\|'danger'\|'neutral'`, `title?`, children, `action?: {label,onClick}`, `actionNode?`, `onDismiss?` |
| `EmptyState` / `FilteredEmptyState` | `icon`, `title`, `description?`, `action?`, `secondaryAction?`, `compact?` / `thing`, `onClear` |
| `Skeleton` | `variant: 'text'\|'kpi'\|'table'\|'chart'\|'block'\|'page'`, `label?` ("Loading …"), `lines?`, `density?` |
| `Dialog` (= `Modal`) | `open`, `onClose`, `title`, `subtitle?`, children, `footer?`, `size: 'sm'\|'md'\|'lg'`, `role`, `dismissible`. Mark first focus with `data-autofocus` |
| `useConfirm()` | `await confirm({ title: 'Delete Maria Kelly?', body, confirmLabel: 'Delete', tone: 'danger'\|'primary', requireText? })` → boolean. Replaces `window.confirm` |
| `ConfirmDialog` | controlled version of the above (`open`, `onConfirm`, `onCancel`, `busy`) |
| `Drawer` | `open`, `onClose`, `title`, `subtitle?`, `headerStart?` (Avatar 40), `headerActions?`, `tabs?`, `footer?`, `size: 'sm'\|'lg'` (480/720), `dirty?` + `onRequestDiscard?` |
| `useToast()` | `toast.success(title, { body?, action?: {label:'Undo', onAction} })`, `.info`, `.warning`, `.error` (persistent), `.show`, `.dismiss`; `errorToastText(requestId)` gives the standard error copy |

### Hooks and helpers
`useDocumentTitle(title)`, `useUrlParam(name)` (drawer/filter state in the URL), `useMediaQuery(q)`,
`formatPct`, `formatFte` ("0.5 FTE"), `formatDate` ("16 Oct 2026"), `cx`.

### Charts (`components/ui/charts`)
| Export | Props |
|---|---|
| `StackedCapacityChart` | `title`, `caption?`, `data: {label, detail?, above, below, undeclared, free, demand?, target?}[]`, `unit: 'FTE'\|'%'`, `height`, `actions?` — includes legend, tooltip and the Chart \| Table switch |
| `TrendLine` | `title`, `caption?`, `data: {label, detail?, planned, implied}[]`, `unit`, `height` |
| `ChartFrame` | `title`, `caption?`, `legend?`, `chart`, `table`, `actions?` (wrap any custom Recharts chart) |
| `useChartColors()` | resolved `--chart-*` token values for Recharts props |

### Shell helpers (`components/shell`)
`useWsPath()` → `(sub) => '/o/:org/w/:ws/' + sub` (works in `/demo/w/:ws`), `useTimeBasis(default)` →
`{ key, basis: TimeBasis, quarter, quarters, caption, setKey }`, `<TimeBasisControl state={…} />`,
`<RequirePermission anyOf={[...]} requiredRole="Planner">`, `<RequireFeature flag="…">`, `searchTarget(kind, id)`.
Toasts, confirmations and the global "This record changed" conflict dialog are mounted by the shell.
