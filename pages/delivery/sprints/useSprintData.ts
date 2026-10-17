/**
 * Data and actions for Sprint planning (SH-05, the v1.1 QBR sprint module behind `features.qbrSprintModule`).
 * Everything goes through the API client (cookie session + CSRF), never `fetch`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../../state';
import type {
  QBRBooking,
  QBRChapter,
  QBRCoE,
  QBRMember,
  QBROKR,
  QBRProject,
  QBRQuarter,
  QBRScenario,
  QBRSprint,
  QBRSquad,
  QBRSquadMember,
  QBRTribe,
} from '../../../types';

export interface SprintOverview {
  tribes: QBRTribe[];
  chapters: QBRChapter[];
  coe: QBRCoE[];
  quarters: QBRQuarter[];
  stats: { members?: number; projects?: number; tribes?: number; chapters?: number; coe?: number };
}

export interface QuarterData {
  sprints: QBRSprint[];
  bookings: QBRBooking[];
  members: QBRMember[];
  projects: QBRProject[];
  okrs: QBROKR[];
  squads: QBRSquad[];
  scenarios: QBRScenario[];
}

const EMPTY_QUARTER: QuarterData = {
  sprints: [],
  bookings: [],
  members: [],
  projects: [],
  okrs: [],
  squads: [],
  scenarios: [],
};

export interface BookingInput {
  memberId: string;
  projectId: string;
  sprintId: string;
  percentage: number;
}

export function useSprintData(wsId: string | null) {
  const { api } = useApi();
  const [overview, setOverview] = useState<SprintOverview | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [quarterId, setQuarterId] = useState('');
  const [data, setData] = useState<QuarterData>(EMPTY_QUARTER);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioBookings, setScenarioBookings] = useState<QBRBooking[]>([]);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const loadOverview = useCallback(async () => {
    if (!wsId) return;
    try {
      const o = await api.qbr.get<SprintOverview>(wsId, 'overview');
      if (!live.current) return;
      setOverview(o);
      setQuarterId((prev) => {
        if (prev && o.quarters.some((q) => q.id === prev)) return prev;
        if (!o.quarters.length) return '';
        return (o.quarters.find((q) => q.is_active) ?? o.quarters[o.quarters.length - 1]).id;
      });
      setStatus('ready');
    } catch (e) {
      if (!live.current) return;
      setError(e);
      setStatus('error');
    }
  }, [api, wsId]);

  const loadQuarter = useCallback(
    async (qId: string) => {
      if (!wsId || !qId) return;
      try {
        const [q, m, p, o, sq, sc] = await Promise.all([
          api.qbr.get<{ sprints: QBRSprint[]; bookings: QBRBooking[] }>(wsId, `quarter/${qId}`),
          api.qbr.get<{ members: QBRMember[] }>(wsId, 'members'),
          api.qbr.get<{ projects: QBRProject[] }>(wsId, 'projects'),
          api.qbr.get<{ okrs: QBROKR[] }>(wsId, 'okrs'),
          api.qbr.get<{ squads: QBRSquad[]; squadMembers: Array<QBRSquadMember & { squad_id: string }> }>(
            wsId,
            'squads',
          ),
          api.qbr.get<{ scenarios: QBRScenario[] }>(wsId, 'scenarios', { quarterId: qId }),
        ]);
        if (!live.current) return;
        setData({
          sprints: q.sprints ?? [],
          bookings: q.bookings ?? [],
          members: m.members ?? [],
          projects: p.projects ?? [],
          okrs: o.okrs ?? [],
          squads: (sq.squads ?? []).map((s) => ({
            ...s,
            members: (sq.squadMembers ?? []).filter((x) => x.squad_id === s.id),
          })),
          scenarios: sc.scenarios ?? [],
        });
      } catch (e) {
        if (live.current) setError(e);
      }
    },
    [api, wsId],
  );

  const loadScenario = useCallback(
    async (id: string) => {
      if (!wsId) return;
      const d = await api.qbr.get<{ bookings: QBRBooking[] }>(wsId, `scenario/${id}`);
      if (live.current) setScenarioBookings(d.bookings ?? []);
    },
    [api, wsId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load; state is set when the request resolves
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the quarter changes
    if (quarterId) void loadQuarter(quarterId);
  }, [quarterId, loadQuarter]);

  const actions = useMemo(
    () => ({
      async seed() {
        if (!wsId) return;
        await api.qbr.post(wsId, 'seed');
        await loadOverview();
        if (quarterId) await loadQuarter(quarterId);
      },
      async book(b: BookingInput) {
        if (!wsId) return;
        await api.qbr.post(wsId, 'booking', { ...b, scenarioId });
        await loadQuarter(quarterId);
        if (scenarioId) await loadScenario(scenarioId);
      },
      async createScenario(name: string) {
        if (!wsId) return;
        const d = await api.qbr.post<{ scenario?: QBRScenario }>(wsId, 'scenario', { name, quarterId });
        if (d.scenario) {
          setScenarioId(d.scenario.id);
          await loadQuarter(quarterId);
          await loadScenario(d.scenario.id);
        }
      },
      async openScenario(id: string) {
        setScenarioId(id);
        await loadScenario(id);
      },
      exitScenario() {
        setScenarioId(null);
        setScenarioBookings([]);
      },
      async commitScenario(id: string) {
        if (!wsId) return;
        await api.qbr.post(wsId, `scenario/${id}/commit`);
        setScenarioId(null);
        setScenarioBookings([]);
        await loadQuarter(quarterId);
      },
      async discardScenario(id: string) {
        if (!wsId) return;
        await api.qbr.remove(wsId, `scenario/${id}`);
        if (scenarioId === id) {
          setScenarioId(null);
          setScenarioBookings([]);
        }
        await loadQuarter(quarterId);
      },
      reload: async () => {
        setStatus('loading');
        await loadOverview();
        if (quarterId) await loadQuarter(quarterId);
      },
    }),
    [api, wsId, quarterId, scenarioId, loadOverview, loadQuarter, loadScenario],
  );

  return {
    status,
    error,
    overview,
    quarterId,
    setQuarterId,
    data,
    scenarioId,
    bookings: scenarioId ? scenarioBookings : data.bookings,
    actions,
  };
}

/** Average booked % per sprint for a member over the quarter. */
export function averageUtil(bookings: QBRBooking[], memberId: string, sprintCount: number): number {
  if (!sprintCount) return 0;
  const total = bookings.filter((b) => b.member_id === memberId).reduce((s, b) => s + b.percentage, 0);
  return Math.round(total / sprintCount);
}
