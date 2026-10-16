/**
 * Living reference of the components/ui kit (dev builds only, route `…/w/:ws/kit`). Used for visual review
 * and by page authors to see every primitive with the tokens applied.
 */
import { useMemo, useState } from 'react';
import { Download, Ellipsis, Pencil, Plus, RefreshCw, Trash2, Upload, Users } from 'lucide-react';
import { useQuarters, useWorkspace, useWorkspaceData } from '../../state';
import { buildPeopleRows, type PersonRow } from '../../utils/viewModels';
import {
  Avatar,
  BandPill,
  BandValue,
  Banner,
  Button,
  ButtonGroup,
  Card,
  CellButton,
  Checkbox,
  Combobox,
  CraftChip,
  DataTable,
  DateField,
  Drawer,
  EmptyState,
  FilterBar,
  FilterChip,
  FormField,
  HeatStrip,
  IconButton,
  KpiGrid,
  KpiTile,
  Menu,
  NumberField,
  PageHeader,
  ProvenanceTag,
  QuarterLoadBar,
  QuarterPicker,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Select,
  Skeleton,
  StatusPill,
  Switch,
  Tabs,
  Tag,
  TextField,
  Textarea,
  useConfirm,
  useToast,
  type Column,
} from '../../components/ui';
import { StackedCapacityChart } from '../../components/ui/charts';
import { TimeBasisControl, useTimeBasis } from '../../components/shell/TimeBasis';
import './kit.css';

export default function KitGallery() {
  const toast = useToast();
  const confirm = useConfirm();
  const quarters = useQuarters();
  const { thresholds } = useWorkspace();
  const { snapshot } = useWorkspaceData();
  const basis = useTimeBasis('qbr1');
  const [tab, setTab] = useState('people');
  const [density, setDensity] = useState('compact');
  const [check, setCheck] = useState(true);
  const [sw, setSw] = useState(true);
  const [radio, setRadio] = useState('locked');
  const [num, setNum] = useState<number | null>(95);
  const [person, setPerson] = useState<string | null>('r1');
  const [quarter, setQuarter] = useState(quarters[0]?.key ?? 'window');
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const rows = useMemo(
    () => (snapshot ? buildPeopleRows(snapshot, quarters, thresholds) : []),
    [snapshot, quarters, thresholds],
  );
  const filtered = rows.filter((r) => r.person.name.toLowerCase().includes(search.toLowerCase()));
  const crafts = snapshot?.crafts ?? [];
  const craftById = new Map(crafts.map((c) => [c.id, c]));

  const columns: Column<PersonRow>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 240,
      sortValue: (r) => r.person.name,
      cell: (r) => (
        <CellButton
          leading={<Avatar name={r.person.name} size={24} />}
          sublabel={r.person.role}
          onClick={() => setDrawer(true)}
        >
          {r.person.name}
        </CellButton>
      ),
    },
    {
      id: 'crafts',
      header: 'Crafts',
      hideable: true,
      cell: (r) => (
        <span className="kit-chips">
          {r.primary ? <CraftChip craft={r.primary} /> : null}
          {r.secondary.slice(0, 2).map((s) => (
            <CraftChip key={s.craft.id} craft={s.craft} via="secondary" proficiency={s.proficiency} maxPct={s.maxPct} />
          ))}
        </span>
      ),
    },
    ...quarters.map<Column<PersonRow>>((q, i) => ({
      id: q.key,
      header: q.label,
      align: 'right',
      width: 96,
      sortValue: (r) => r.quarters[i]?.relativePct ?? 0,
      cell: (r) => (
        <BandValue
          band={r.quarters[i]?.band ?? null}
          pct={r.quarters[i]?.relativePct ?? 0}
          context={`${r.person.name}, ${q.label}`}
        />
      ),
    })),
    {
      id: 'load',
      header: 'QBR1 load',
      width: 220,
      hideable: true,
      cell: (r) => {
        const q = r.quarters[0];
        return q ? (
          <QuarterLoadBar
            quarterLabel="QBR1"
            above={q.above}
            below={q.below}
            undeclared={q.undeclared}
            free={q.free}
            target={r.person.targetUtil}
          />
        ) : null;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Component kit"
        breadcrumbs={[{ label: 'System' }, { label: 'Component kit' }]}
        description="Every components/ui primitive rendered with the Corporate Blue tokens. Development builds only."
        actions={
          <>
            <Button variant="secondary" iconBefore={Upload}>
              Import
            </Button>
            <Button variant="primary" iconBefore={Plus}>
              Add person
            </Button>
          </>
        }
        overflow={[
          { id: 'csv', label: 'Export CSV', icon: Download, onSelect: () => toast.success('Export started') },
          { id: 'sync', label: 'Sync now', icon: RefreshCw },
          { id: 'del', label: 'Delete workspace', icon: Trash2, danger: true },
        ]}
        timeBasis={<TimeBasisControl state={basis} />}
        tabs={
          <Tabs
            label="Kit sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'people', label: 'People', count: rows.length },
              { id: 'forms', label: 'Forms' },
              { id: 'feedback', label: 'Feedback' },
            ]}
          />
        }
      />
      <div className="pcp-page pcp-stack">
        <KpiGrid label="Key figures">
          <KpiTile
            label="Squad utilisation"
            value="94%"
            band="on-target"
            delta={{ direction: 'up', text: '+6 pts vs QBR2' }}
            caption={basis.caption}
            sparkline={[71, 78, 84, 90, 94]}
            onHelp={() => undefined}
          />
          <KpiTile
            label="Next quarter"
            value="88%"
            band="under"
            delta={{ direction: 'down', text: '−6 pts vs QBR1' }}
            caption="QBR2 · Q1 2027"
          />
          <KpiTile label="Unstaffed demand" value="3.5 FTE" caption={basis.caption} />
          <KpiTile label="People over capacity" value="2" band="over" caption={basis.caption} />
        </KpiGrid>

        {tab === 'people' ? (
          <DataTable
            id="kit-people"
            caption="People and quarterly utilisation"
            columns={columns}
            rows={filtered}
            getRowId={(r) => r.person.id}
            densityToggle
            columnToggle
            defaultDensity="compact"
            selectable
            selectedIds={selected}
            onSelectionChange={setSelected}
            bulkActions={() => (
              <>
                <Button size="sm" iconBefore={Pencil}>
                  Edit chapter
                </Button>
                <Button size="sm">Set target</Button>
              </>
            )}
            toolbar={
              <FilterBar
                search={<SearchField value={search} onChange={setSearch} placeholder="Search people" size="sm" />}
                chips={[<FilterChip key="c" label="Chapter" value="Delivery" onRemove={() => undefined} />]}
                onClearAll={() => undefined}
              />
            }
            maxHeight={420}
          />
        ) : null}

        <div className="pcp-grid">
          <div className="pcp-col-lg-6">
            <Card title="Buttons" subtitle="Primary, secondary, subtle, danger, link · sm, md, lg">
              <div className="pcp-stack pcp-stack--md">
                <ButtonGroup>
                  <Button variant="primary" iconBefore={Plus}>
                    Add person
                  </Button>
                  <Button variant="secondary">Cancel</Button>
                  <Button variant="subtle" iconBefore={Pencil}>
                    Edit
                  </Button>
                  <Button variant="danger" iconBefore={Trash2}>
                    Delete
                  </Button>
                  <Button variant="link">View all</Button>
                </ButtonGroup>
                <ButtonGroup>
                  <Button variant="primary" size="sm">
                    Small
                  </Button>
                  <Button variant="primary" size="lg">
                    Large
                  </Button>
                  <Button variant="primary" loading>
                    Saving
                  </Button>
                  <Button variant="primary" disabled>
                    Disabled
                  </Button>
                  <IconButton icon={Ellipsis} label="More actions" variant="secondary" />
                  <IconButton icon={Pencil} label="Edit" />
                  <Menu
                    trigger={<Button iconAfter={Ellipsis}>Menu</Button>}
                    items={[
                      { id: 'a', label: 'Edit', icon: Pencil },
                      { id: 'b', label: 'Export CSV', icon: Download, shortcut: 'E' },
                      { id: 'c', label: 'Delete', icon: Trash2, danger: true },
                    ]}
                  />
                </ButtonGroup>
              </div>
            </Card>
          </div>
          <div className="pcp-col-lg-6">
            <Card title="Status and identity" subtitle="Lozenges, bands, crafts, provenance, tags">
              <div className="pcp-stack pcp-stack--md">
                <div className="pcp-row pcp-row--wrap">
                  <StatusPill tone="success">Confirmed</StatusPill>
                  <StatusPill tone="warning">Tentative</StatusPill>
                  <StatusPill tone="danger">Failed</StatusPill>
                  <StatusPill tone="info">Planview</StatusPill>
                  <StatusPill tone="neutral">Archived</StatusPill>
                  <StatusPill tone="brand">Forecast</StatusPill>
                </div>
                <div className="pcp-row pcp-row--wrap">
                  <BandPill band="bench" />
                  <BandPill band="under" />
                  <BandPill band="on-target" />
                  <BandPill band="over" value={112} />
                </div>
                <div className="pcp-row pcp-row--wrap">
                  {crafts.slice(0, 3).map((c) => (
                    <CraftChip key={c.id} craft={c} />
                  ))}
                  {crafts[3] ? <CraftChip craft={crafts[3]} via="secondary" proficiency={3} maxPct={50} /> : null}
                  {crafts[4] ? <CraftChip craft={crafts[4]} via="secondary" proficiency={1} undeclared /> : null}
                  <ProvenanceTag source="manual" />
                  <ProvenanceTag source="jira" />
                  <ProvenanceTag source="planview" />
                  <Tag onRemove={() => undefined}>Stakeholder mgmt</Tag>
                </div>
                <div className="pcp-row pcp-row--wrap pcp-row--md">
                  <Avatar name="Maria Kelly" size={24} />
                  <Avatar name="Tom Hayes" size={28} />
                  <Avatar name="Emer Ward" size={32} linked />
                  <Avatar name="Gokul Gurijala" size={40} />
                  <HeatStrip
                    cells={quarters.map((q, i) => ({
                      label: q.label,
                      detail: q.calendarLabel,
                      pct: [48, 72, 98, 118][i] ?? 0,
                      band: (['bench', 'under', 'on-target', 'over'] as const)[i] ?? 'bench',
                    }))}
                  />
                </div>
                <QuarterLoadBar quarterLabel="QBR1" above={60} below={30} undeclared={8} free={10} size="md" />
              </div>
            </Card>
          </div>
          <div className="pcp-col-lg-6">
            <Card title="Form controls">
              <div className="kit-form">
                <FormField label="Name" help="As shown on the People page.">
                  <TextField value="Maria Kelly" onChange={() => undefined} />
                </FormField>
                <FormField label="Target utilisation" error="Enter 0–200">
                  <NumberField value={num} onChange={setNum} min={0} max={200} unit="%" />
                </FormField>
                <FormField label="Chapter" optional>
                  <Select
                    value="delivery"
                    onChange={() => undefined}
                    options={[
                      { value: 'delivery', label: 'Delivery' },
                      { value: 'risk', label: 'Risk and governance' },
                    ]}
                  />
                </FormField>
                <FormField label="Person">
                  <Combobox
                    value={person}
                    onChange={setPerson}
                    clearable
                    options={(snapshot?.people ?? []).map((p) => ({
                      value: p.id,
                      label: p.name,
                      description: p.role,
                      leading: <Avatar name={p.name} size={24} />,
                      group: craftById.get(p.primaryCraft ?? '')?.name ?? 'No craft',
                    }))}
                  />
                </FormField>
                <FormField label="Start date">
                  <DateField value="2026-10-01" onChange={() => undefined} />
                </FormField>
                <FormField label="Quarter">
                  <QuarterPicker quarters={quarters} value={quarter} onChange={setQuarter} />
                </FormField>
                <FormField label="Note" optional className="kit-form__wide">
                  <Textarea rows={2} placeholder="Why is this needed?" />
                </FormField>
                <div className="pcp-stack pcp-stack--sm">
                  <Checkbox checked={check} onChange={setCheck} label="Include tentative bookings" />
                  <Checkbox checked={false} indeterminate onChange={() => undefined} label="Some selected" />
                  <Switch checked={sw} onChange={setSw} label="Daily Jira sync" description="Runs at 02:00 UTC." />
                </div>
                <RadioGroup
                  label="Planview bookings"
                  value={radio}
                  onChange={setRadio}
                  options={[
                    { value: 'locked', label: 'Locked: change them in Planview' },
                    { value: 'overridable', label: 'Overridable by Planners' },
                  ]}
                />
                <SegmentedControl
                  label="Density"
                  value={density}
                  onChange={setDensity}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'comfortable', label: 'Comfortable' },
                  ]}
                />
              </div>
            </Card>
          </div>
          <div className="pcp-col-lg-6">
            <div className="pcp-stack">
              <Card title="Feedback">
                <div className="pcp-stack pcp-stack--md">
                  <Banner tone="info" action={{ label: 'Review', onClick: () => undefined }}>
                    3 craft changes are waiting for approval.
                  </Banner>
                  <Banner tone="warning" title="Sync is stale.">
                    Jira last synced 3 days ago.
                  </Banner>
                  <Banner tone="danger" onDismiss={() => undefined}>
                    Jira sync failed. Check the API token in Settings.
                  </Banner>
                  <ButtonGroup>
                    <Button onClick={() => toast.success('Person saved', { body: 'Maria Kelly was updated.' })}>
                      Success toast
                    </Button>
                    <Button
                      onClick={() =>
                        toast.success('2 people deleted', { action: { label: 'Undo', onAction: () => undefined } })
                      }
                    >
                      Undo toast
                    </Button>
                    <Button onClick={() => toast.error('Something went wrong. Try again, or quote reference 7f3a2c.')}>
                      Error toast
                    </Button>
                  </ButtonGroup>
                  <ButtonGroup>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Delete Maria Kelly?',
                          body: 'Her 3 bookings will also be deleted. You can undo this for 8 seconds.',
                          confirmLabel: 'Delete',
                        });
                        if (ok)
                          toast.success('Maria Kelly deleted', {
                            action: { label: 'Undo', onAction: () => undefined },
                          });
                      }}
                    >
                      Confirm dialog
                    </Button>
                    <Button onClick={() => setDrawer(true)}>Open drawer</Button>
                  </ButtonGroup>
                </div>
              </Card>
              <Card title="Empty and loading" flush>
                <EmptyState
                  icon={Users}
                  title="No people yet"
                  description="Add your squad to start planning capacity."
                  action={
                    <Button variant="primary" iconBefore={Plus}>
                      Add person
                    </Button>
                  }
                  compact
                />
                <div className="kit-skeleton">
                  <Skeleton variant="text" label="details" />
                </div>
              </Card>
            </div>
          </div>
          <div className="pcp-col-12">
            <StackedCapacityChart
              title="Squad capacity by quarter"
              caption="QBR1–QBR4 · FTE"
              data={quarters.map((q, i) => ({
                label: q.label,
                detail: q.calendarLabel,
                above: [6.2, 5.8, 4.9, 3.6][i] ?? 0,
                below: [2.1, 1.9, 1.4, 0.8][i] ?? 0,
                undeclared: [0.4, 0.3, 0.2, 0][i] ?? 0,
                free: [1.3, 2, 3.5, 5.6][i] ?? 0,
                demand: [9.5, 8.8, 7.1, 6.2][i],
                target: 10,
              }))}
            />
          </div>
        </div>
      </div>
      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Maria Kelly"
        subtitle="Senior Project Manager · Delivery"
        headerStart={<Avatar name="Maria Kelly" size={40} />}
        footer={
          <>
            <Button onClick={() => setDrawer(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDrawer(false)}>
              Save
            </Button>
          </>
        }
      >
        <dl className="pcp-dl">
          <dt>Chapter</dt>
          <dd>Delivery</dd>
          <dt>Target</dt>
          <dd className="pcp-tnum">100%</dd>
          <dt>Home tribe</dt>
          <dd>Digital</dd>
        </dl>
      </Drawer>
    </>
  );
}
