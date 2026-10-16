export const FEATURE_FLAGS = ['qbrSprintModule', 'aiAssistant', 'scenarios', 'planviewScheduledImport', 'jiraScheduledSync'] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;
export const DEFAULT_FEATURES: FeatureFlags = {
  qbrSprintModule: false, aiAssistant: false, scenarios: false, planviewScheduledImport: false, jiraScheduledSync: true,
};
export function resolveFeatures(stored: Partial<FeatureFlags> | null | undefined): FeatureFlags {
  return { ...DEFAULT_FEATURES, ...(stored ?? {}) };
}
