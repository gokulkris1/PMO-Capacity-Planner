/**
 * Reports (RP-04) — route `/o/:org/w/:ws/reports`. QBR pack (PDF, loaded on demand) and CSV exports, plus
 * on-page utilisation and demand reports. Requires `export`.
 */
import { useMemo, useState } from 'react';
import { Clock, Download, FileChartColumn, FileSpreadsheet, FileText, Lock } from 'lucide-react';
import type * as D from '../../shared/contracts/dto';
import { useQuarters, useRecordExport, useWorkspace } from '../../state';
import { buildCapacityOutlook, buildDemandGrid } from '../../utils/viewModels';
import {
  BandCell,
  Button,
  Card,
  downloadText,
  EmptyState,
  errorMessage,
  fmt,
  PageHeader,
  SegmentedControl,
  useToast,
  TableScroll,
} from '../../components/ui';
import { PageBody } from '../../components/shell/PageBody';
import { useDelivery } from '../../state';
import {
  bookingsCsv,
  buildQbrPack,
  medianHours,
  openDemandCsv,
  timeToStaffCsv,
  timeToStaffRows,
  utilisationByGroupCsv,
  utilisationByPersonCsv,
} from '../../utils/reportData';
import './reports.css';

export default function ReportsPage() {
  const { can } = useWorkspace();
  return (
    <div className="pcp-page">
      <PageHeader
        breadcrumbs={[{ label: 'Reports' }]}
        title="Reports"
        description="The QBR pack and CSV exports for the next four quarters, plus utilisation and demand at a glance."
      />
      {can('export') ? (
        <PageBody label="reports">{(s) => <ReportsBody snapshot={s} />}</PageBody>
      ) : (
        <Card>
          <EmptyState
            icon={Lock}
            title="You don't have access to reports"
            description="Ask a PMO Admin for a role that includes exports."
          />
        </Card>
      )}
    </div>
  );
}

function ReportsBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const toast = useToast();
  const { thresholds, org, workspace } = useWorkspace();
  const quarters = useQuarters();
  const delivery = useDelivery(s);
  const recordExport = useRecordExport();
  const [busy, setBusy] = useState<string | null>(null);
  const [pivot, setPivot] = useState<'tribe' | 'chapter' | 'craft'>('tribe');
  const stamp = s.serverTime.slice(0, 10);
  const tts = useMemo(() => timeToStaffRows(s), [s]);

  const csv = (name: string, make: () => string) => {
    try {
      downloadText(`${name}-${stamp}.csv`, make());
      // RP-04#AC4: exports are audited; a failed audit call never blocks the download.
      void recordExport({ kind: name, format: 'csv' }).catch(() => undefined);
      toast.show({ tone: 'success', title: 'Download started', body: `${name}-${stamp}.csv` });
    } catch (e) {
      toast.show({ tone: 'error', title: 'Export failed', body: errorMessage(e) });
    }
  };
  const pdf = async () => {
    setBusy('pdf');
    try {
      const { downloadQbrPack } = await import('../../utils/qbrPackPdf');
      await downloadQbrPack(buildQbrPack(s, quarters, thresholds, delivery), {
        org: org?.name ?? s.org.name,
        workspace: workspace?.name ?? s.workspace.name,
        generatedAt: stamp, // ISO date, as QbrPackMeta expects (QA-031)
        filename: `qbr-pack-${quarters[0]?.key ?? stamp}.pdf`,
      });
      void recordExport({ kind: 'qbr-pack', format: 'pdf' }).catch(() => undefined);
      toast.show({ tone: 'success', title: 'QBR pack downloaded' });
    } catch (e) {
      toast.show({ tone: 'error', title: 'The QBR pack could not be generated', body: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const exports: Array<{
    key: string;
    icon: typeof FileText;
    title: string;
    body: string;
    run(): void;
    primary?: boolean;
  }> = [
    {
      key: 'pdf',
      icon: FileChartColumn,
      title: 'QBR pack (PDF)',
      body: 'Cover, squad utilisation QBR1–QBR4 vs target, supply vs demand by craft, open demand, over/under lists, delivery signal by tribe and time to staff.',
      run: () => void pdf(),
      primary: true,
    },
    {
      key: 'person',
      icon: FileSpreadsheet,
      title: 'Utilisation by person (CSV)',
      body: 'Load and % of target per person for QBR1–QBR4 with the band.',
      run: () => csv('utilisation-by-person', () => utilisationByPersonCsv(s, quarters, thresholds)),
    },
    {
      key: 'group',
      icon: FileSpreadsheet,
      title: `Utilisation by ${pivot} (CSV)`,
      body: 'Supply, load, free capacity, demand and utilisation per group and quarter. Choose the grouping below.',
      run: () => csv(`utilisation-by-${pivot}`, () => utilisationByGroupCsv(s, quarters, thresholds, pivot)),
    },
    {
      key: 'demand',
      icon: FileSpreadsheet,
      title: 'Open demand (CSV)',
      body: 'Demand lines not yet staffed, with proposed and open FTE.',
      run: () => csv('open-demand', () => openDemandCsv(s, quarters, thresholds)),
    },
    {
      key: 'bookings',
      icon: FileSpreadsheet,
      title: 'Bookings (CSV)',
      body: 'Every booking with craft, dates, state and source.',
      run: () => csv('bookings', () => bookingsCsv(s)),
    },
    {
      key: 'tts',
      icon: Clock,
      title: 'Time to staff (CSV)',
      body: 'Marketplace proposals with the time until the person responded.',
      run: () => csv('time-to-staff', () => timeToStaffCsv(s)),
    },
  ];

  const outlook = useMemo(
    () => buildCapacityOutlook(s, quarters, { pivot, thresholds }),
    [s, quarters, pivot, thresholds],
  );
  const demand = useMemo(() => buildDemandGrid(s, quarters), [s, quarters]);
  const med = medianHours(tts);

  return (
    <div className="pcp-stack">
      <div className="rp-grid" role="list" aria-label="Exports">
        {exports.map((e) => {
          const Icon = e.icon;
          return (
            <section key={e.key} className="rp-card" role="listitem" aria-labelledby={`rp-${e.key}`}>
              <Icon className="rp-card__icon" size={20} strokeWidth={1.75} aria-hidden="true" />
              <h2 className="rp-card__title" id={`rp-${e.key}`}>
                {e.title}
              </h2>
              <p className="rp-card__body">{e.body}</p>
              <div>
                <Button
                  variant={e.primary ? 'primary' : 'secondary'}
                  size="sm"
                  iconBefore={Download}
                  loading={busy === e.key}
                  onClick={e.run}
                >
                  Download
                </Button>
              </div>
            </section>
          );
        })}
      </div>

      <Card
        title="Utilisation report"
        subtitle="Load as % of target per group and quarter"
        flush
        actions={
          <SegmentedControl<'tribe' | 'chapter' | 'craft'>
            size="sm"
            label="Group by"
            value={pivot}
            onChange={setPivot}
            options={[
              { value: 'tribe', label: 'Tribe' },
              { value: 'chapter', label: 'Chapter' },
              { value: 'craft', label: 'Craft' },
            ]}
          />
        }
      >
        <TableScroll>
          <table className="pcp-tbl pcp-tbl--compact">
            <caption className="pcp-sr-only">Utilisation by {pivot}</caption>
            <thead>
              <tr>
                <th scope="col">{pivot[0].toUpperCase() + pivot.slice(1)}</th>
                {quarters.map((q) => (
                  <th key={q.key} scope="col" className="pcp-num" title={fmt.quarterTooltip(q)}>
                    {q.label}
                  </th>
                ))}
                <th scope="col" className="pcp-num">
                  Supply {quarters[0]?.label}
                </th>
                <th scope="col" className="pcp-num">
                  Demand {quarters[0]?.label}
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { id: '__squad', label: 'Squad', points: outlook.squad },
                ...outlook.rows.filter((r) => r.points.some((p) => p.supplyFte > 0)),
              ].map((r) => (
                <tr key={r.id} className={r.id === '__squad' ? 'pcp-tbl-total' : undefined}>
                  <th scope="row">{r.label}</th>
                  {r.points.map((p, i) => (
                    <td key={p.quarterKey} className="pcp-num rp-util">
                      <BandCell value={p.utilisationPct} band={p.band} label={`${r.label} ${quarters[i]?.label}`} />
                    </td>
                  ))}
                  <td className="pcp-num">{fmt.fte(r.points[0]?.supplyFte)}</td>
                  <td className="pcp-num">{fmt.fte(r.points[0]?.demandFte)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card title="Demand report" subtitle="Captured demand against confirmed staffing, all projects" flush>
        <TableScroll>
          <table className="pcp-tbl pcp-tbl--compact">
            <caption className="pcp-sr-only">Demand summary by quarter</caption>
            <thead>
              <tr>
                <th scope="col">Quarter</th>
                <th scope="col" className="pcp-num">
                  Demand FTE
                </th>
                <th scope="col" className="pcp-num">
                  Staffed FTE
                </th>
                <th scope="col" className="pcp-num">
                  Proposed FTE
                </th>
                <th scope="col" className="pcp-num">
                  Gap FTE
                </th>
                <th scope="col" className="pcp-num">
                  Projects with a gap
                </th>
              </tr>
            </thead>
            <tbody>
              {quarters.map((q, i) => {
                const cells = demand.map((d) => d.cells[i]);
                const gap = cells.reduce((x, c) => x + Math.max(0, c.gapFte), 0);
                return (
                  <tr key={q.key}>
                    <th scope="row">
                      {q.label} <span className="pcp-caption pcp-text-tertiary">{q.calendarLabel}</span>
                    </th>
                    <td className="pcp-num">{fmt.fte(cells.reduce((x, c) => x + c.demandFte, 0))}</td>
                    <td className="pcp-num">{fmt.fte(cells.reduce((x, c) => x + c.staffedFte, 0))}</td>
                    <td className="pcp-num">{fmt.fte(cells.reduce((x, c) => x + c.proposedFte, 0))}</td>
                    <td className="pcp-num">
                      {gap > 0.04 ? (
                        <span className="rp-gap">{fmt.fte(gap)}</span>
                      ) : (
                        <span className="pcp-text-tertiary">0.0</span>
                      )}
                    </td>
                    <td className="pcp-num">{cells.filter((c) => c.gapFte > 0.04).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
        <div className="pcp-card__footer">
          <span className="pcp-caption pcp-text-tertiary">
            Time to staff:{' '}
            {med === null
              ? 'no proposals answered yet'
              : `median ${med < 48 ? `${Math.round(med)} hours` : `${Math.round(med / 24)} days`} across ${tts.length} answered proposals`}
          </span>
        </div>
      </Card>
    </div>
  );
}
