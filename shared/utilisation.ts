export type UtilBand = 'bench' | 'under' | 'on-target' | 'over';
export interface UtilisationThresholds { benchBelow: number; onTargetFrom: number; onTargetTo: number }
export const DEFAULT_THRESHOLDS: UtilisationThresholds = { benchBelow: 50, onTargetFrom: 90, onTargetTo: 105 };
export const BAND_LABEL: Record<UtilBand, string> = {
  bench: 'Available', under: 'Under target', 'on-target': 'On target', over: 'Over capacity',
};
/** pct is load as a percentage of target (100 = exactly on target). Rounded to an integer first. */
export function bandFor(pct: number, t: UtilisationThresholds = DEFAULT_THRESHOLDS): UtilBand {
  const p = Math.round(pct);
  if (p > t.onTargetTo) return 'over';
  if (p >= t.onTargetFrom) return 'on-target';
  if (p >= t.benchBelow) return 'under';
  return 'bench';
}
/** loadPct = summed allocation %; targetUtil defaults to 100. */
export function relativeLoad(loadPct: number, targetUtil?: number | null): number {
  const target = targetUtil && targetUtil > 0 ? targetUtil : 100;
  return (100 * loadPct) / target;
}
export function bandForLoad(loadPct: number, targetUtil?: number | null, t: UtilisationThresholds = DEFAULT_THRESHOLDS): UtilBand {
  return bandFor(relativeLoad(loadPct, targetUtil), t);
}
/** Returns null when valid, else a user-facing message. */
export function validateThresholds(t: UtilisationThresholds): string | null {
  const ok = t.benchBelow > 0 && t.benchBelow < t.onTargetFrom && t.onTargetFrom <= t.onTargetTo && t.onTargetTo <= 200;
  return ok ? null : 'On-target range must start below where it ends, and above the Available threshold.';
}
