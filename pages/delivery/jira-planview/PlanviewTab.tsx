/**
 * Planview import (PV-01, PV-02 test): preview diff before apply (new / changed / removed projects and
 * assignments, unmatched people), apply selected changes, and test the field map with a sample record.
 * Connection and field-map editing live in Settings › Integrations (B1).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, Eye, FlaskConical, Play } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useWorkspace } from '../../../state';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  cx,
  EmptyState,
  errorMessage,
  fmt,
  Select,
  StatusPill,
  useToast,
  TableScroll,
} from '../../../components/ui';
import { useWsPath } from '../../../components/shell/workspacePath';
import type { DeliverySource, PlanviewApplyResult, PlanviewFieldTest } from '../../../state';

type Section =
  | 'projects.new'
  | 'projects.changed'
  | 'projects.removed'
  | 'assignments.new'
  | 'assignments.changed'
  | 'assignments.removed';

export function PlanviewTab({ snapshot: s, delivery }: { snapshot: D.WorkspaceSnapshot; delivery: DeliverySource }) {
  const toast = useToast();
  const { can } = useWorkspace();
  const wsPath = useWsPath();
  const canRun = can('integrations.run');
  const [preview, setPreview] = useState<D.PlanviewPreviewDTO | null>(null);
  const [accept, setAccept] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<PlanviewApplyResult | null>(null);
  const [test, setTest] = useState<PlanviewFieldTest | null>(null);

  const runPreview = async () => {
    setBusy('preview');
    setResult(null);
    try {
      const p = await delivery.planviewPreview();
      setPreview(p);
      // Everything selected by default except removals (PV-01#AC2).
      setAccept(
        new Set([
          ...p.projects.new.map((x) => x.externalId),
          ...p.projects.changed.map((x) => x.externalId),
          ...p.assignments.new.map((x) => x.externalId),
          ...p.assignments.changed.map((x) => x.externalId),
        ]),
      );
      setPeople(
        Object.fromEntries(p.assignments.unmatchedPeople.map((u) => [u.externalId, u.suggestedPersonId ?? ''])),
      );
    } catch (e) {
      toast.show({ tone: 'error', title: 'Preview failed', body: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy('apply');
    try {
      const all = (sec: Array<{ externalId: string }>) => sec.map((x) => x.externalId).filter((id) => accept.has(id));
      const res = await delivery.planviewApply(preview.previewId, {
        projects: [...all(preview.projects.new), ...all(preview.projects.changed), ...all(preview.projects.removed)],
        assignments: [
          ...all(preview.assignments.new),
          ...all(preview.assignments.changed),
          ...all(preview.assignments.removed),
        ],
        personMatches: Object.fromEntries(Object.entries(people).filter(([, v]) => v)),
      });
      setResult(res);
      setPreview(null);
      toast.show({
        tone: 'success',
        title: 'Planview import applied',
        body: `${res.created} created, ${res.updated} updated, ${res.skipped} skipped`,
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      toast.show({
        tone: 'error',
        title: status === 409 ? 'This preview expired. Run it again.' : 'Import not applied',
        body: status === 409 ? undefined : errorMessage(e),
      });
    } finally {
      setBusy(null);
    }
  };
  const runTest = async () => {
    setBusy('test');
    try {
      setTest(await delivery.planviewTestMapping());
    } catch (e) {
      toast.show({ tone: 'error', title: 'Test failed', body: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const count = preview
    ? [
        ...preview.projects.new,
        ...preview.projects.changed,
        ...preview.projects.removed,
        ...preview.assignments.new,
        ...preview.assignments.changed,
        ...preview.assignments.removed,
      ].filter((x) => accept.has(x.externalId)).length
    : 0;
  const toggle = (id: string, on: boolean) =>
    setAccept((cur) => {
      const n = new Set(cur);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <div className="pcp-stack">
      <Card
        title="Import from Planview"
        subtitle="Planview owns project existence and dates; the planner owns craft demand and PMO bookings. Manual and Marketplace bookings are never changed."
        actions={
          canRun && (
            <>
              <Button size="sm" iconBefore={FlaskConical} loading={busy === 'test'} onClick={() => void runTest()}>
                Test with sample record
              </Button>
              <Button
                size="sm"
                variant="primary"
                iconBefore={Eye}
                loading={busy === 'preview'}
                onClick={() => void runPreview()}
              >
                Preview import
              </Button>
            </>
          )
        }
      >
        {result && (
          <Banner
            tone="success"
            title={`${result.created} created, ${result.updated} updated, ${result.skipped} skipped`}
          >
            Re-running the preview now should report no new or changed items.
          </Banner>
        )}
        {!preview && !result && (
          <p className="pcp-text-secondary dl-pv-hint">
            Run a preview to see exactly what would change before anything is written.
          </p>
        )}
        {can('integrations.manage') && (
          <p className="pcp-caption pcp-text-tertiary">
            Field map and credentials:{' '}
            <Link className="pcp-link" to={wsPath('settings/integrations')}>
              Settings › Integrations
            </Link>
          </p>
        )}
      </Card>

      {test && <FieldTest test={test} />}

      {preview && (
        <>
          {preview.partial && <Banner tone="warning" title="Partial preview: narrow the date range" />}
          <div className="pcp-row dl-pv-bar">
            <span className="pcp-caption pcp-text-tertiary">
              Preview expires {fmt.relative(preview.expiresAt, s.serverTime)} · {count} change{count === 1 ? '' : 's'}{' '}
              selected
            </span>
            <span className="pcp-spacer" />
            <Button onClick={() => setPreview(null)}>Discard preview</Button>
            <Button
              variant="primary"
              iconBefore={Play}
              disabled={count === 0}
              loading={busy === 'apply'}
              onClick={() => void apply()}
            >
              Apply {count} change{count === 1 ? '' : 's'}
            </Button>
          </div>
          <DiffSection
            title="New projects"
            section="projects.new"
            items={preview.projects.new}
            accept={accept}
            onToggle={toggle}
          />
          <DiffSection
            title="Changed projects"
            section="projects.changed"
            items={preview.projects.changed}
            accept={accept}
            onToggle={toggle}
          />
          <DiffSection
            title="Removed in Planview"
            section="projects.removed"
            items={preview.projects.removed}
            accept={accept}
            onToggle={toggle}
          />
          <DiffSection
            title="New assignments"
            section="assignments.new"
            items={preview.assignments.new.map((a) => ({
              externalId: a.externalId,
              name: `${a.personName} · ${a.projectExternalId}`,
              changes: a.changes,
              unmatched: !a.personId,
            }))}
            accept={accept}
            onToggle={toggle}
          />
          <DiffSection
            title="Changed assignments"
            section="assignments.changed"
            items={preview.assignments.changed.map((a) => ({
              externalId: a.externalId,
              name: `${a.personName} · ${a.projectExternalId}`,
              changes: a.changes,
            }))}
            accept={accept}
            onToggle={toggle}
          />
          {preview.assignments.unmatchedPeople.length > 0 && (
            <Card
              flush
              title="Unmatched people"
              subtitle="Choose the squad member for each Planview person; your choice is remembered for the next import."
            >
              <TableScroll>
                <table className="pcp-tbl">
                  <caption className="pcp-sr-only">Unmatched Planview people</caption>
                  <thead>
                    <tr>
                      <th scope="col">Planview person</th>
                      <th scope="col">Email</th>
                      <th scope="col">Squad member</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.assignments.unmatchedPeople.map((u) => (
                      <tr key={u.externalId}>
                        <th scope="row">{u.name}</th>
                        <td>{u.email ?? '—'}</td>
                        <td className="dl-map__select">
                          <Select
                            size="sm"
                            aria-label={`Squad member for ${u.name}`}
                            value={people[u.externalId] ?? ''}
                            placeholder="Skip: not in the squad"
                            onValueChange={(v) => setPeople((p) => ({ ...p, [u.externalId]: v }))}
                            options={s.people.map((p) => ({ value: p.id, label: p.name }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Card>
          )}
        </>
      )}
      {!preview && !test && !result && !canRun && (
        <EmptyState icon={Eye} title="Only Planners can run the Planview import" />
      )}
    </div>
  );
}

function DiffSection({
  title,
  section,
  items,
  accept,
  onToggle,
}: {
  title: string;
  section: Section;
  items: Array<{ externalId: string; name: string; changes: D.FieldChange[]; unmatched?: boolean }>;
  accept: Set<string>;
  onToggle(id: string, on: boolean): void;
}) {
  const removed = section.endsWith('removed');
  if (items.length === 0)
    return (
      <Card dense>
        <div className="pcp-row">
          <span className="pcp-strong">{title}</span>
          <StatusPill>0</StatusPill>
          <span className="pcp-caption pcp-text-tertiary">Nothing to change</span>
        </div>
      </Card>
    );
  const all = items.every((i) => accept.has(i.externalId));
  return (
    <Card
      flush
      title={`${title} · ${items.length}`}
      subtitle={removed ? 'Not selected by default. Removing a project in the planner keeps its history.' : undefined}
    >
      <TableScroll>
        <table className="pcp-tbl">
          <caption className="pcp-sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="pcp-tbl-check">
                <Checkbox
                  aria-label={`Select all ${title.toLowerCase()}`}
                  checked={all}
                  onChange={(v) => items.forEach((i) => onToggle(i.externalId, v))}
                />
              </th>
              <th scope="col">Item</th>
              <th scope="col">Planview id</th>
              <th scope="col">Changes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.externalId} className={cx(accept.has(i.externalId) && 'is-selected')}>
                <td className="pcp-tbl-check">
                  <Checkbox
                    aria-label={`Apply ${i.name}`}
                    checked={accept.has(i.externalId)}
                    onChange={(v) => onToggle(i.externalId, v)}
                  />
                </td>
                <th scope="row">
                  <span className="pcp-row">
                    {i.name}
                    {i.unmatched && (
                      <StatusPill tone="warning" icon={CircleAlert}>
                        Person unmatched
                      </StatusPill>
                    )}
                  </span>
                </th>
                <td className="pcp-tnum">{i.externalId}</td>
                <td>
                  {i.changes.length === 0 ? (
                    <span className="pcp-text-tertiary">{removed ? 'No longer in Planview' : '—'}</span>
                  ) : (
                    <ul className="dl-diff">
                      {i.changes.map((c) => (
                        <li key={c.field}>
                          <span className="pcp-caption pcp-text-tertiary">{c.field}</span>{' '}
                          {c.from ? <span className="dl-diff__from">{fmtVal(c.from)}</span> : null}
                          {c.from ? ' → ' : ''}
                          <span className="pcp-strong">{fmtVal(c.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

const fmtVal = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmt.date(v) : (v ?? '—'));

function FieldTest({ test }: { test: PlanviewFieldTest }) {
  const missing = test.fields.filter((f) => f.required && (f.value === null || f.value === ''));
  const json = useMemo(() => JSON.stringify(test.source, null, 2), [test.source]);
  return (
    <Card
      title="Field map test"
      subtitle="One project and one assignment fetched from Planview; secrets are never shown"
    >
      {missing.length > 0 ? (
        <Banner tone="danger" title={`${missing.length} required field${missing.length === 1 ? '' : 's'} missing`}>
          {missing
            .map((f) => `${f.entity === 'project' ? 'Project' : 'Assignment'} ${f.field.toLowerCase()} (${f.path})`)
            .join(', ')}
        </Banner>
      ) : (
        <Banner tone="success" title="Every required field resolved" />
      )}
      <div className="pcp-grid-xl dl-test">
        <div className="pcp-span-6">
          <pre className="pcp-code-block" aria-label="Source record">
            {json}
          </pre>
        </div>
        <div className="pcp-span-6">
          <table className="pcp-tbl pcp-tbl--compact">
            <caption className="pcp-sr-only">Mapped values</caption>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Path</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {test.fields.map((f) => {
                const bad = f.required && (f.value === null || f.value === '');
                return (
                  <tr key={`${f.entity}.${f.field}`}>
                    <th scope="row">
                      <span className="pcp-caption pcp-text-tertiary">
                        {f.entity === 'project' ? 'Project' : 'Assignment'}
                      </span>{' '}
                      {f.field}
                    </th>
                    <td className="pcp-tnum">{f.path}</td>
                    <td>
                      {bad ? (
                        <span className="pcp-field__error">
                          <CircleAlert size={12} aria-hidden="true" /> Missing (required)
                        </span>
                      ) : (
                        <span className="pcp-row">
                          <CircleCheck size={12} aria-hidden="true" className="pcp-icon-status--success" />
                          {f.value ?? <span className="pcp-text-tertiary">Empty</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
