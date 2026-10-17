/**
 * Time-basis and quarter-view types shared by the client data layer (`state/`) and the
 * view-models. They live here (a pure module) so `utils/viewModels/**` never imports from
 * `state/` (which imports React). `state/index.ts` re-exports both names, which is where
 * BACKLOG §4.3 declares them.
 */
import type * as D from '../../shared/contracts/dto';

export type TimeBasis = { kind: 'today' } | { kind: 'quarter'; key: D.QuarterKey } | { kind: 'window' };

export interface QuarterView {
  key: D.QuarterKey;
  index: 0 | 1 | 2 | 3;
  label: 'QBR1' | 'QBR2' | 'QBR3' | 'QBR4';
  calendarLabel: string;
  fiscalLabel: string;
  start: D.ISODate;
  end: D.ISODate;
}
