import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Ellipsis, Network, Pencil, Plus, Sparkles } from 'lucide-react';
import type { ChapterDTO, TeamDTO, TribeDTO } from '../../shared/contracts/dto';
import { useMutations, useWorkspace, useWorkspaceData } from '../../state';
import {
  Banner,
  Button,
  Combobox,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  IconButton,
  Menu,
  StatusPill,
  Tabs,
  TextField,
  useConfirm,
  useTabParam,
  useToast,
  type Column,
} from '../../components/ui';
import { SectionBody, SectionHeader, errorText } from './common';

type Kind = 'tribes' | 'chapters' | 'teams';
type Entity = TribeDTO | ChapterDTO | TeamDTO;
const KINDS = ['tribes', 'chapters', 'teams'] as const;
const SINGULAR: Record<Kind, string> = { tribes: 'tribe', chapters: 'chapter', teams: 'team' };
const TITLE: Record<Kind, string> = { tribes: 'Tribes', chapters: 'Chapters', teams: 'Teams' };

/** Settings › Structure (ORG-03): tribes, chapters and teams. Read-only without structure.write. */
export default function StructureSettings() {
  const { can } = useWorkspace();
  const { snapshot, status } = useWorkspaceData();
  const m = useMutations();
  const toast = useToast();
  const confirm = useConfirm();
  const editable = can('structure.write');
  const [tab, setTab] = useTabParam(KINDS, 'tribes');
  const [dialog, setDialog] = useState<null | { kind: Kind; entity: Entity | null }>(null);
  const [name, setName] = useState('');
  const [lead, setLead] = useState<string | null>(null);
  const [leadName, setLeadName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const people = snapshot?.people ?? [];
    const projects = snapshot?.projects ?? [];
    const by = <T,>(arr: T[], key: (x: T) => string | null) => {
      const map = new Map<string, number>();
      for (const x of arr) {
        const k = key(x);
        if (k) map.set(k, (map.get(k) ?? 0) + 1);
      }
      return map;
    };
    return {
      tribePeople: by(people, (p) => p.homeTribeId),
      tribeProjects: by(projects, (p) => p.tribeId),
      chapterPeople: by(people, (p) => p.chapterId),
      teamPeople: by(people, (p) => p.teamId),
    };
  }, [snapshot]);

  const personName = useMemo(() => new Map((snapshot?.people ?? []).map((p) => [p.id, p.name])), [snapshot]);
  const craftName = useMemo(() => new Map((snapshot?.crafts ?? []).map((c) => [c.id, c.name])), [snapshot]);

  const openDialog = (kind: Kind, entity: Entity | null) => {
    setName(entity?.name ?? '');
    setLead(kind === 'chapters' ? ((entity as ChapterDTO | null)?.leadPersonId ?? null) : null);
    setLeadName(kind === 'tribes' ? ((entity as TribeDTO | null)?.leadName ?? '') : '');
    setError(null);
    setDialog({ kind, entity });
  };

  const save = async () => {
    if (!dialog) return;
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    const list = (snapshot?.[dialog.kind] ?? []) as Entity[];
    if (list.some((e) => e.id !== dialog.entity?.id && e.name.trim().toLowerCase() === name.trim().toLowerCase())) {
      setError(`A ${SINGULAR[dialog.kind]} with this name already exists.`);
      return;
    }
    setBusy(true);
    try {
      const base = dialog.entity ? { id: dialog.entity.id, version: dialog.entity.version } : {};
      const extra =
        dialog.kind === 'chapters'
          ? { leadPersonId: lead }
          : dialog.kind === 'tribes'
            ? { leadName: leadName.trim() || null }
            : {};
      await m.structure.save(dialog.kind, { ...base, name: name.trim(), ...extra });
      toast.success(dialog.entity ? `${name.trim()} saved` : `${name.trim()} added`);
      setDialog(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async (kind: Kind, e: Entity) => {
    if (!e.archived) {
      const ok = await confirm({
        title: `Archive ${e.name}?`,
        body: `It stays on existing records but is hidden from pickers. You can restore it at any time.`,
        confirmLabel: 'Archive',
        tone: 'primary',
      });
      if (!ok) return;
    }
    try {
      await m.structure.archive(kind, e.id, !e.archived);
      toast.success(e.archived ? `${e.name} restored` : `${e.name} archived`);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const createChaptersFromCrafts = async () => {
    if (!snapshot) return;
    const used = [...new Set(snapshot.people.map((p) => p.primaryCraft).filter((c): c is string => !!c))];
    const existing = new Set(snapshot.chapters.map((c) => c.craftId));
    const todo = used.filter((c) => !existing.has(c));
    if (todo.length === 0) {
      toast.info('Every above-the-table craft already has a chapter.');
      return;
    }
    const ok = await confirm({
      title: `Create ${todo.length} chapter${todo.length === 1 ? '' : 's'}?`,
      body: (
        <>
          <p>One chapter per above-the-table craft in use. People are assigned by their primary craft:</p>
          <ul className="pcp-auth__list">
            {todo.map((c) => (
              <li key={c}>{craftName.get(c) ?? c}</li>
            ))}
          </ul>
        </>
      ),
      confirmLabel: 'Create chapters',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      for (const craftId of todo)
        await m.structure.save('chapters', { name: craftName.get(craftId) ?? craftId, craftId, leadPersonId: null });
      toast.success(`${todo.length} chapters created`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const statusCell = (e: Entity) =>
    e.archived ? <StatusPill tone="neutral">Archived</StatusPill> : <StatusPill tone="success">Active</StatusPill>;
  const actionsCell = (kind: Kind) => (e: Entity) =>
    editable ? (
      <Menu
        trigger={<IconButton icon={Ellipsis} label={`Actions for ${e.name}`} size="sm" />}
        items={[
          { id: 'edit', label: 'Rename', icon: Pencil, onSelect: () => openDialog(kind, e) },
          e.archived
            ? { id: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => void toggleArchive(kind, e) }
            : { id: 'archive', label: 'Archive', icon: Archive, onSelect: () => void toggleArchive(kind, e) },
        ]}
      />
    ) : null;

  const nameCol = (kind: Kind): Column<Entity> => ({
    id: 'name',
    header: 'Name',
    width: 260,
    sortValue: (e) => e.name,
    cell: (e) =>
      editable ? (
        <button type="button" className="pcp-cell-button" onClick={() => openDialog(kind, e)}>
          {e.name}
        </button>
      ) : (
        <strong>{e.name}</strong>
      ),
  });
  const actionsCol = (kind: Kind): Column<Entity> => ({
    id: 'actions',
    header: <span className="pcp-sr-only">Actions</span>,
    headerText: 'Actions',
    align: 'right',
    width: 56,
    cell: actionsCell(kind),
  });

  const columns: Record<Kind, Column<Entity>[]> = {
    tribes: [
      nameCol('tribes'),
      {
        id: 'lead',
        header: 'Tribe lead',
        sortValue: (e) => (e as TribeDTO).leadName ?? '',
        cell: (e) => (e as TribeDTO).leadName ?? <span className="pcp-settings__muted">—</span>,
      },
      {
        id: 'people',
        header: 'People',
        align: 'right',
        sortValue: (e) => counts.tribePeople.get(e.id) ?? 0,
        cell: (e) => counts.tribePeople.get(e.id) ?? 0,
      },
      {
        id: 'projects',
        header: 'Projects',
        align: 'right',
        sortValue: (e) => counts.tribeProjects.get(e.id) ?? 0,
        cell: (e) => counts.tribeProjects.get(e.id) ?? 0,
      },
      { id: 'status', header: 'Status', sortValue: (e) => (e.archived ? 1 : 0), cell: statusCell },
      actionsCol('tribes'),
    ],
    chapters: [
      nameCol('chapters'),
      {
        id: 'lead',
        header: 'Chapter lead',
        sortValue: (e) => personName.get((e as ChapterDTO).leadPersonId ?? '') ?? '',
        cell: (e) =>
          personName.get((e as ChapterDTO).leadPersonId ?? '') ?? <span className="pcp-settings__muted">No lead</span>,
      },
      {
        id: 'craft',
        header: 'Craft',
        sortValue: (e) => craftName.get((e as ChapterDTO).craftId ?? '') ?? '',
        cell: (e) => craftName.get((e as ChapterDTO).craftId ?? '') ?? '—',
      },
      {
        id: 'people',
        header: 'People',
        align: 'right',
        sortValue: (e) => counts.chapterPeople.get(e.id) ?? 0,
        cell: (e) => counts.chapterPeople.get(e.id) ?? 0,
      },
      { id: 'status', header: 'Status', sortValue: (e) => (e.archived ? 1 : 0), cell: statusCell },
      actionsCol('chapters'),
    ],
    teams: [
      nameCol('teams'),
      {
        id: 'people',
        header: 'People',
        align: 'right',
        sortValue: (e) => counts.teamPeople.get(e.id) ?? 0,
        cell: (e) => counts.teamPeople.get(e.id) ?? 0,
      },
      { id: 'status', header: 'Status', sortValue: (e) => (e.archived ? 1 : 0), cell: statusCell },
      actionsCol('teams'),
    ],
  };

  const rows = ((snapshot?.[tab] ?? []) as Entity[])
    .slice()
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const emptyNode =
    tab === 'chapters' && editable ? (
      <EmptyState
        icon={Network}
        title="No chapters yet"
        description="Chapters group people by their above-the-table craft, with a chapter lead."
        action={
          <Button variant="primary" iconBefore={Sparkles} onClick={() => void createChaptersFromCrafts()}>
            Create chapters from crafts
          </Button>
        }
        secondaryAction={
          <Button variant="link" onClick={() => openDialog('chapters', null)}>
            Add chapter
          </Button>
        }
        compact
      />
    ) : (
      <EmptyState
        icon={Network}
        title={`No ${TITLE[tab].toLowerCase()} yet`}
        description={
          editable
            ? `Add your first ${SINGULAR[tab]} to group people and projects.`
            : 'Ask a PMO Admin to set up the structure.'
        }
        action={
          editable ? (
            <Button variant="primary" iconBefore={Plus} onClick={() => openDialog(tab, null)}>
              Add {SINGULAR[tab]}
            </Button>
          ) : undefined
        }
        compact
      />
    );

  return (
    <>
      <SectionHeader
        id="structure"
        actions={
          editable ? (
            <Button variant="primary" iconBefore={Plus} onClick={() => openDialog(tab, null)}>
              Add {SINGULAR[tab]}
            </Button>
          ) : undefined
        }
      />
      <SectionBody wide>
        {!editable ? (
          <Banner tone="info">You can view the structure. PMO Admins and Org Admins can change it.</Banner>
        ) : null}
        <Tabs
          label="Structure"
          value={tab}
          onChange={(id) => setTab(id as Kind)}
          tabs={KINDS.map((k) => ({
            id: k,
            label: TITLE[k],
            count: ((snapshot?.[k] ?? []) as Entity[]).filter((e) => !e.archived).length,
          }))}
        />
        <DataTable
          key={tab}
          id={`settings-${tab}`}
          caption={TITLE[tab]}
          columns={columns[tab]}
          rows={rows}
          getRowId={(e) => e.id}
          status={status === 'error' ? 'error' : snapshot ? 'ready' : 'loading'}
          empty={emptyNode}
          maxHeight="none"
        />
      </SectionBody>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        size="sm"
        title={dialog ? `${dialog.entity ? 'Edit' : 'Add'} ${SINGULAR[dialog.kind]}` : ''}
        dismissible={!busy}
        footer={
          <>
            <Button onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              {dialog?.entity ? 'Save' : `Add ${dialog ? SINGULAR[dialog.kind] : ''}`}
            </Button>
          </>
        }
      >
        <div className="pcp-settings__form">
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <FormField label="Name">
            <TextField value={name} onChange={(e) => setName(e.target.value)} data-autofocus="" />
          </FormField>
          {dialog?.kind === 'tribes' ? (
            <FormField label="Tribe lead" optional>
              <TextField value={leadName} onChange={(e) => setLeadName(e.target.value)} />
            </FormField>
          ) : null}
          {dialog?.kind === 'chapters' ? (
            <FormField
              label="Chapter lead"
              optional
              help="Craft-change approvals for this chapter go to the lead first."
            >
              <Combobox
                value={lead}
                onChange={setLead}
                clearable
                placeholder="Search people"
                options={(snapshot?.people ?? []).map((p) => ({ value: p.id, label: p.name, description: p.role }))}
              />
            </FormField>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
