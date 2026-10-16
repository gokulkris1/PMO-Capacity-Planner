import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Ellipsis, Layers, Pencil, Plus } from 'lucide-react';
import type { CraftDTO } from '../../shared/contracts/dto';
import { useMutations, useWorkspace, useWorkspaceData } from '../../state';
import {
  Banner,
  Button,
  CraftChip,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  IconButton,
  Menu,
  StatusPill,
  TextField,
  Textarea,
  useConfirm,
  useToast,
  type Column,
} from '../../components/ui';
import { SectionBody, SectionHeader, errorText } from './common';

const SHORT_RE = /^[A-Z0-9]{2,4}$/;

/** Settings › Crafts (ORG-04): the craft catalogue. Read-only without structure.write. */
export default function CraftsSettings() {
  const { can } = useWorkspace();
  const { snapshot, status } = useWorkspaceData();
  const m = useMutations();
  const toast = useToast();
  const confirm = useConfirm();
  const editable = can('structure.write');
  const [dialog, setDialog] = useState<null | { craft: CraftDTO | null }>(null);
  const [form, setForm] = useState({ name: '', short: '', family: '', description: '' });
  const [errors, setErrors] = useState<{ name?: string; short?: string }>({});
  const [busy, setBusy] = useState(false);

  const crafts = useMemo(
    () =>
      (snapshot?.crafts ?? [])
        .slice()
        .sort((a, b) => Number(a.archived) - Number(b.archived) || a.sortOrder - b.sortOrder),
    [snapshot],
  );
  const holders = useMemo(() => {
    const above = new Map<string, number>();
    const below = new Map<string, number>();
    for (const p of snapshot?.people ?? []) {
      if (p.primaryCraft) above.set(p.primaryCraft, (above.get(p.primaryCraft) ?? 0) + 1);
      for (const s of p.secondaryCrafts) below.set(s.craftId, (below.get(s.craftId) ?? 0) + 1);
    }
    return { above, below };
  }, [snapshot]);

  const open = (craft: CraftDTO | null) => {
    setForm({
      name: craft?.name ?? '',
      short: craft?.short ?? '',
      family: craft?.family ?? '',
      description: craft?.description ?? '',
    });
    setErrors({});
    setDialog({ craft });
  };

  const save = async () => {
    if (!dialog) return;
    const errs: typeof errors = {};
    const short = form.short.trim().toUpperCase();
    if (!form.name.trim()) errs.name = 'Enter a name.';
    if (!SHORT_RE.test(short)) errs.short = 'Use 2–4 capital letters or digits, e.g. SD.';
    else if (crafts.some((c) => c.id !== dialog.craft?.id && c.short.toUpperCase() === short))
      errs.short = 'Another craft already uses this code.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const base = dialog.craft
        ? { id: dialog.craft.id, version: dialog.craft.version }
        : { sortOrder: crafts.length ? Math.max(...crafts.map((c) => c.sortOrder)) + 1 : 0 };
      await m.structure.save('crafts', {
        ...base,
        name: form.name.trim(),
        short,
        family: form.family.trim() || null,
        description: form.description.trim() || null,
      });
      toast.success(dialog.craft ? `${form.name.trim()} saved` : `${form.name.trim()} added to the catalogue`);
      setDialog(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const move = async (craft: CraftDTO, dir: -1 | 1) => {
    const active = crafts.filter((c) => !c.archived);
    const i = active.findIndex((c) => c.id === craft.id);
    const other = active[i + dir];
    if (!other) return;
    try {
      await m.structure.save('crafts', { id: craft.id, version: craft.version, sortOrder: other.sortOrder });
      await m.structure.save('crafts', { id: other.id, version: other.version, sortOrder: craft.sortOrder });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const toggleArchive = async (craft: CraftDTO) => {
    if (!craft.archived) {
      const inUse = (holders.above.get(craft.id) ?? 0) + (holders.below.get(craft.id) ?? 0);
      const ok = await confirm({
        title: `Archive ${craft.name}?`,
        body: inUse
          ? `${inUse} people hold this craft. It stays on their profiles and historic numbers are unchanged, but it is hidden from pickers.`
          : 'It is hidden from pickers. You can restore it at any time.',
        confirmLabel: 'Archive',
        tone: 'primary',
      });
      if (!ok) return;
    }
    try {
      await m.structure.archive('crafts', craft.id, !craft.archived);
      toast.success(craft.archived ? `${craft.name} restored` : `${craft.name} archived`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const activeIds = crafts.filter((c) => !c.archived).map((c) => c.id);
  const columns: Column<CraftDTO>[] = [
    {
      id: 'name',
      header: 'Craft',
      width: 240,
      sortValue: (c) => c.name,
      cell: (c) =>
        editable ? (
          <button type="button" className="pcp-cell-button" onClick={() => open(c)}>
            {c.name}
          </button>
        ) : (
          <strong>{c.name}</strong>
        ),
    },
    { id: 'short', header: 'Code', width: 88, sortValue: (c) => c.short, cell: (c) => <CraftChip craft={c} /> },
    {
      id: 'family',
      header: 'Family',
      hideable: true,
      sortValue: (c) => c.family ?? '',
      cell: (c) => c.family ?? <span className="pcp-settings__muted">—</span>,
    },
    {
      id: 'desc',
      header: 'Description',
      hideable: true,
      cell: (c) => (
        <span className="pcp-truncate" title={c.description ?? undefined} style={{ display: 'block', maxWidth: 320 }}>
          {c.description ?? <span className="pcp-settings__muted">—</span>}
        </span>
      ),
    },
    {
      id: 'holders',
      header: 'Holders (above / below)',
      headerText: 'Holders',
      align: 'right',
      sortValue: (c) => (holders.above.get(c.id) ?? 0) + (holders.below.get(c.id) ?? 0),
      csvValue: (c) => `${holders.above.get(c.id) ?? 0} / ${holders.below.get(c.id) ?? 0}`,
      cell: (c) => (
        <span className="pcp-tnum">
          {holders.above.get(c.id) ?? 0} / {holders.below.get(c.id) ?? 0}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (c) => (c.archived ? 1 : 0),
      cell: (c) =>
        c.archived ? <StatusPill tone="neutral">Archived</StatusPill> : <StatusPill tone="success">Active</StatusPill>,
    },
    {
      id: 'actions',
      header: <span className="pcp-sr-only">Actions</span>,
      headerText: 'Actions',
      align: 'right',
      width: 56,
      cell: (c) =>
        editable ? (
          <Menu
            trigger={<IconButton icon={Ellipsis} label={`Actions for ${c.name}`} size="sm" />}
            items={[
              { id: 'edit', label: 'Edit', icon: Pencil, onSelect: () => open(c) },
              {
                id: 'up',
                label: 'Move up',
                icon: ArrowUp,
                disabled: c.archived || activeIds[0] === c.id,
                onSelect: () => void move(c, -1),
              },
              {
                id: 'down',
                label: 'Move down',
                icon: ArrowDown,
                disabled: c.archived || activeIds[activeIds.length - 1] === c.id,
                onSelect: () => void move(c, 1),
              },
              c.archived
                ? { id: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => void toggleArchive(c) }
                : { id: 'archive', label: 'Archive', icon: Archive, onSelect: () => void toggleArchive(c) },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <>
      <SectionHeader
        id="crafts"
        actions={
          editable ? (
            <Button variant="primary" iconBefore={Plus} onClick={() => open(null)}>
              Add craft
            </Button>
          ) : undefined
        }
      />
      <SectionBody wide>
        {!editable ? (
          <Banner tone="info">You can view the catalogue. PMO Admins and Org Admins can change it.</Banner>
        ) : null}
        <DataTable
          id="settings-crafts"
          caption="Craft catalogue"
          columns={columns}
          rows={crafts}
          getRowId={(c) => c.id}
          status={status === 'error' ? 'error' : snapshot ? 'ready' : 'loading'}
          columnToggle
          maxHeight="none"
          empty={
            <EmptyState
              icon={Layers}
              title="No crafts yet"
              description="Crafts are the PMO disciplines people declare, such as Programme management."
              action={
                editable ? (
                  <Button variant="primary" iconBefore={Plus} onClick={() => open(null)}>
                    Add craft
                  </Button>
                ) : undefined
              }
              compact
            />
          }
        />
      </SectionBody>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.craft ? `Edit ${dialog.craft.name}` : 'Add craft'}
        subtitle={dialog?.craft ? 'Renaming keeps the craft id, so historic numbers do not change.' : undefined}
        dismissible={!busy}
        footer={
          <>
            <Button onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              {dialog?.craft ? 'Save' : 'Add craft'}
            </Button>
          </>
        }
      >
        <div className="pcp-settings__form">
          <div className="pcp-settings__grid-2">
            <FormField label="Name" error={errors.name}>
              <TextField
                value={form.name}
                placeholder="Service design"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-autofocus=""
              />
            </FormField>
            <FormField label="Short code" error={errors.short} help="2–4 capital letters or digits.">
              <TextField
                value={form.short}
                placeholder="SD"
                maxLength={4}
                onChange={(e) => setForm({ ...form, short: e.target.value.toUpperCase() })}
              />
            </FormField>
          </div>
          <FormField label="Family" optional help="Groups related crafts, e.g. Delivery or Governance.">
            <TextField value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} />
          </FormField>
          <FormField label="Description" optional>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
