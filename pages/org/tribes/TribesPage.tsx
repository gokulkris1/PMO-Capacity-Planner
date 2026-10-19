/**
 * Tribes (ORG-05#AC1) — route `/o/:org/w/:ws/org/tribes`.
 * Each tribe with projects, demand QBR1–QBR4, QBR1 staffed and gap, PMO people serving and the delivery signal.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, Plus } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useMutations, useQuarters, useWorkspace } from '../../../state';
import { buildTribeView } from '../../../utils/viewModels';
import {
  Banner,
  Button,
  Card,
  Dialog,
  EmptyState,
  fmt,
  FormField,
  PageHeader,
  StatusPill,
  TableScroll,
  TextField,
  useToast,
} from '../../../components/ui';
import { errorText } from '../../settings/common';
import { PageBody } from '../../../components/shell/PageBody';
import { useWsPath } from '../../../components/shell/workspacePath';
import { deliverySignalOf as deliverySignal, useDelivery } from '../../../state';
import './tribes.css';

/** Add a tribe from the Tribes page itself (same API as Settings › Structure, which also edits and archives). */
function AddTribeDialog({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: string[] }) {
  const m = useMutations();
  const toast = useToast();
  const [name, setName] = useState('');
  const [leadName, setLeadName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setName('');
    setLeadName('');
    setError(null);
    onClose();
  };
  const save = async () => {
    const n = name.trim();
    if (!n) return setError('Enter a name.');
    if (existing.some((e) => e.trim().toLowerCase() === n.toLowerCase())) return setError('Already exists');
    setBusy(true);
    try {
      await m.structure.save('tribes', { name: n, leadName: leadName.trim() || null });
      toast.success(`${n} added`);
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title="Add tribe"
      dismissible={!busy}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Add tribe
          </Button>
        </>
      }
    >
      <form
        className="pcp-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <FormField label="Name">
          <TextField value={name} onChange={(e) => setName(e.target.value)} data-autofocus="" />
        </FormField>
        <FormField label="Tribe lead" optional>
          <TextField value={leadName} onChange={(e) => setLeadName(e.target.value)} />
        </FormField>
        <p className="pcp-text-secondary">Rename, archive and manage chapters and teams in Settings › Structure.</p>
      </form>
    </Dialog>
  );
}

export default function TribesPage() {
  const { can } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const editable = can('structure.write');
  return (
    <div className="pcp-page">
      <PageHeader
        breadcrumbs={[{ label: 'Organisation' }, { label: 'Tribes' }]}
        title="Tribes"
        description="Demand, PMO staffing and delivery signal per tribe for the next four quarters."
        actions={
          editable ? (
            <Button variant="primary" iconBefore={Plus} onClick={() => setAdding(true)}>
              Add tribe
            </Button>
          ) : undefined
        }
      />
      <PageBody label="tribes">
        {(s) => (
          <>
            <TribesBody snapshot={s} onAdd={editable ? () => setAdding(true) : undefined} />
            <AddTribeDialog open={adding} onClose={() => setAdding(false)} existing={s.tribes.map((t) => t.name)} />
          </>
        )}
      </PageBody>
    </div>
  );
}

function TribesBody({ snapshot: s, onAdd }: { snapshot: D.WorkspaceSnapshot; onAdd?: () => void }) {
  const quarters = useQuarters();
  const wsPath = useWsPath();
  const delivery = useDelivery(s);
  const views = useMemo(
    () =>
      s.tribes
        .filter((t) => !t.archived)
        .map((t) => buildTribeView(s, quarters, t.id))
        .sort((a, z) => a.tribe.name.localeCompare(z.tribe.name)),
    [s, quarters],
  );
  const q1 = quarters[0];
  if (views.length === 0)
    return (
      <Card>
        <EmptyState
          icon={Network}
          title="No tribes yet"
          description={
            onAdd
              ? 'Tribes are the business units your PMO serves. Add the first one to group projects and demand.'
              : 'A PMO Admin adds tribes here or in Settings › Structure.'
          }
          action={
            onAdd ? (
              <Button variant="primary" iconBefore={Plus} onClick={onAdd}>
                Add tribe
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  return (
    <Card flush>
      <TableScroll>
        <table className="pcp-tbl tr-table">
          <caption className="pcp-sr-only">Tribes</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="pcp-tbl-sticky tr-col-name">
                Tribe
              </th>
              <th scope="col" rowSpan={2} className="pcp-num">
                Projects
              </th>
              <th scope="colgroup" colSpan={quarters.length} className="tr-group">
                Demand (FTE)
              </th>
              <th scope="colgroup" colSpan={2} className="tr-group">
                {fmt.quarterCaption(q1)}
              </th>
              <th scope="col" rowSpan={2} className="pcp-num">
                People serving
              </th>
              <th scope="col" rowSpan={2}>
                Delivery signal
              </th>
            </tr>
            <tr>
              {quarters.map((q, i) => (
                <th
                  key={q.key}
                  scope="col"
                  className={i === 0 ? 'pcp-num tr-first' : 'pcp-num'}
                  title={fmt.quarterTooltip(q)}
                >
                  {q.label}
                </th>
              ))}
              <th scope="col" className="pcp-num tr-first">
                Staffed
              </th>
              <th scope="col" className="pcp-num">
                Gap
              </th>
            </tr>
          </thead>
          <tbody>
            {views.map((v) => {
              const ids = new Set(v.projects.map((p) => p.id));
              const sig = delivery.byProjectQbr1.filter((x) => ids.has(x.projectId));
              const planned = sig.reduce((x, y) => x + y.plannedFte, 0);
              const implied = sig.reduce((x, y) => x + y.impliedFte, 0);
              const signal = sig.length ? deliverySignal(planned, implied) : null;
              const gap = Math.max(0, v.gapFte[0] ?? 0);
              return (
                <tr key={v.tribe.id}>
                  <th scope="row" className="pcp-tbl-sticky tr-col-name">
                    <Link className="pcp-link pcp-strong" to={wsPath(`org/tribes/${v.tribe.id}`)}>
                      {v.tribe.name}
                    </Link>
                    <span className="pcp-caption pcp-text-tertiary tr-lead">
                      {v.tribe.leadName ? `Lead: ${v.tribe.leadName}` : 'No lead set'}
                    </span>
                  </th>
                  <td className="pcp-num">{v.projects.length}</td>
                  {v.demandFte.map((d, i) => (
                    <td key={quarters[i].key} className={i === 0 ? 'pcp-num tr-first' : 'pcp-num'}>
                      {fmt.fte(d)}
                    </td>
                  ))}
                  <td className="pcp-num tr-first">{fmt.fte(v.staffedFte[0])}</td>
                  <td className="pcp-num">
                    {gap > 0.04 ? (
                      <StatusPill tone="danger" title={`${fmt.fte(gap)} FTE of demand is not staffed`}>
                        Gap {fmt.fte(gap)}
                      </StatusPill>
                    ) : (
                      <span className="pcp-text-tertiary">0.0</span>
                    )}
                  </td>
                  <td className="pcp-num">{v.people.length}</td>
                  <td>
                    {signal ? (
                      <span className="tr-signal">
                        <StatusPill tone={signal.kind === 'inline' ? 'success' : 'info'}>
                          {signal.kind === 'inline'
                            ? 'In line'
                            : signal.kind === 'more'
                              ? 'More effort'
                              : 'Less effort'}
                        </StatusPill>
                        <span className="pcp-caption pcp-text-tertiary pcp-tnum">
                          {fmt.fte(planned)} planned · {fmt.fte(implied)} implied
                        </span>
                      </span>
                    ) : (
                      <span className="pcp-text-tertiary">No Jira mapping</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <div className="pcp-card__footer">
        <span className="pcp-caption pcp-text-tertiary">
          Staffed = confirmed bookings on the tribe&apos;s projects. Delivery signal compares planned with Jira-implied
          FTE (signal, not a timesheet).
        </span>
      </div>
    </Card>
  );
}
