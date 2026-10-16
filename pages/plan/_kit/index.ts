/**
 * B2 interim kit barrel. Pages import from here; when B1 publishes components/ui, replace each name with
 * the kit equivalent (see docs/release/handoff-B2.md §4) and delete this folder.
 */
import './kit.css';

export * from './primitives';
export * from './overlays';
export * from './charts';
export * from './PageHeader';
export * from './hooks';
export * from './useAction';
export * as fmt from './format';
export { indexSnapshot, toCsv, downloadText, errorMessage, type SnapshotIndex } from './format';
