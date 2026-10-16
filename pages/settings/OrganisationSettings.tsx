import { useState } from 'react';
import { Pencil, Plus, Trash2, Ellipsis, FolderKanban } from 'lucide-react';
import { ROLE_LABEL } from '../../shared/permissions';
import type { MeWorkspace } from '../../shared/contracts/dto';
import { useMutations, useWorkspace, useWorkspaceData } from '../../state';
import {
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  IconButton,
  Menu,
  RadioGroup,
  StatusPill,
  TextField,
  useConfirm,
  useToast,
  type Column,
} from '../../components/ui';
import { useClientGaps } from '../../components/shell/clientGaps';
import { SectionBody, SectionHeader, errorText } from './common';

/** Settings › Organisation (ST-01#AC2/#AC3, AC-09#AC3). Org Admin only. */
export default function OrganisationSettings() {
  const { org, workspaces, workspace } = useWorkspace();
  const { snapshot } = useWorkspaceData();
  const m = useMutations();
  const gaps = useClientGaps();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(org?.name ?? '');
  const [logo, setLogo] = useState(org?.logoUrl ?? '');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const visibility = snapshot?.org.defaultWorkspaceVisibility ?? 'org';
  const [wsDialog, setWsDialog] = useState<null | { mode: 'add' } | { mode: 'rename'; ws: MeWorkspace }>(null);
  const [wsName, setWsName] = useState('');
  const [wsBusy, setWsBusy] = useState(false);

  if (!org) return null;

  const dirty = name.trim() !== org.name || (logo.trim() || null) !== (org.logoUrl ?? null);

  const save = async () => {
    const url = logo.trim();
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) {
      setLogoError('Use an https:// address.');
      return;
    }
    setLogoError(null);
    setSaving(true);
    try {
      await m.admin.updateOrg({ name: name.trim(), logoUrl: url || null });
      toast.success('Organisation saved');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const setVisibility = async (v: string) => {
    try {
      await m.admin.updateOrg({ defaultWorkspaceVisibility: v as 'org' | 'members' });
      toast.success('Workspace visibility updated');
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const submitWorkspace = async () => {
    if (!wsDialog || !wsName.trim()) return;
    setWsBusy(true);
    try {
      if (wsDialog.mode === 'add') {
        await gaps.org.createWorkspace(wsName.trim());
        toast.success(`Workspace ${wsName.trim()} created`);
      } else {
        await gaps.org.renameWorkspace(wsDialog.ws.id, wsName.trim());
        toast.success('Workspace renamed');
      }
      setWsDialog(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setWsBusy(false);
    }
  };

  const deleteWorkspace = async (ws: MeWorkspace) => {
    const ok = await confirm({
      title: `Delete ${ws.name}?`,
      body: 'All people, projects, demand and bookings in this workspace are deleted. This cannot be undone.',
      confirmLabel: 'Delete workspace',
      tone: 'danger',
      requireText: ws.name,
    });
    if (!ok) return;
    try {
      await gaps.org.deleteWorkspace(ws.id);
      toast.success(`${ws.name} deleted`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const columns: Column<MeWorkspace>[] = [
    {
      id: 'name',
      header: 'Workspace',
      sortValue: (w) => w.name,
      cell: (w) => (
        <span className="pcp-row">
          <strong>{w.name}</strong>
          {w.id === workspace?.id ? <StatusPill tone="brand">Current</StatusPill> : null}
        </span>
      ),
    },
    { id: 'role', header: 'Your role', sortValue: (w) => ROLE_LABEL[w.role], cell: (w) => ROLE_LABEL[w.role] },
    {
      id: 'actions',
      header: <span className="pcp-sr-only">Actions</span>,
      headerText: 'Actions',
      align: 'right',
      width: 64,
      cell: (w) => (
        <Menu
          trigger={<IconButton icon={Ellipsis} label={`Actions for ${w.name}`} size="sm" />}
          items={[
            {
              id: 'rename',
              label: 'Rename',
              icon: Pencil,
              onSelect: () => {
                setWsName(w.name);
                setWsDialog({ mode: 'rename', ws: w });
              },
            },
            { id: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => void deleteWorkspace(w) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <SectionHeader id="organisation" />
      <SectionBody>
        <Card
          title="Organisation details"
          footer={
            <div className="pcp-settings__footer">
              <span className="pcp-settings__footer-note">Changes are recorded in the audit log.</span>
              <Button variant="primary" disabled={!dirty || !name.trim()} loading={saving} onClick={() => void save()}>
                Save changes
              </Button>
            </div>
          }
        >
          <div className="pcp-settings__form">
            <FormField label="Organisation name">
              <TextField value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField
              label="Logo URL"
              optional
              help="An https:// image address shown on the sign-in page."
              error={logoError}
            >
              <TextField value={logo} placeholder="https://" onChange={(e) => setLogo(e.target.value)} />
            </FormField>
            <FormField label="Organisation ID" help="Used in links. It can't be changed.">
              <TextField value={org.slug} readOnly />
            </FormField>
          </div>
        </Card>

        <Card
          title="Workspace visibility"
          subtitle="Who in the organisation can read a workspace they were not invited to."
        >
          <RadioGroup
            label="Workspace visibility"
            hideLabel
            value={visibility}
            onChange={(v) => void setVisibility(v)}
            options={[
              {
                value: 'org',
                label: 'Everyone in the organisation can view every workspace',
                description: 'Members get read-only access to workspaces they were not added to.',
              },
              {
                value: 'members',
                label: 'Only invited members can view a workspace',
                description: 'Use this for confidential portfolios.',
              },
            ]}
          />
        </Card>

        <Card
          title="Workspaces"
          flush
          actions={
            <Button
              size="sm"
              iconBefore={Plus}
              onClick={() => {
                setWsName('');
                setWsDialog({ mode: 'add' });
              }}
            >
              Add workspace
            </Button>
          }
        >
          <DataTable
            id="settings-workspaces"
            caption="Workspaces"
            columns={columns}
            rows={workspaces}
            getRowId={(w) => w.id}
            maxHeight="none"
            className="pcp-table-card--plain"
            empty={<EmptyState icon={FolderKanban} title="No workspaces yet" compact />}
          />
        </Card>
      </SectionBody>

      <Dialog
        open={wsDialog !== null}
        onClose={() => setWsDialog(null)}
        size="sm"
        title={wsDialog?.mode === 'rename' ? 'Rename workspace' : 'Add workspace'}
        footer={
          <>
            <Button onClick={() => setWsDialog(null)}>Cancel</Button>
            <Button variant="primary" loading={wsBusy} disabled={!wsName.trim()} onClick={() => void submitWorkspace()}>
              {wsDialog?.mode === 'rename' ? 'Rename' : 'Add workspace'}
            </Button>
          </>
        }
      >
        <FormField label="Workspace name" help="For example: Delivery PMO, Change Office.">
          <TextField value={wsName} onChange={(e) => setWsName(e.target.value)} data-autofocus="" />
        </FormField>
      </Dialog>
    </>
  );
}
