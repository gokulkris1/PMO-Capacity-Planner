import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, Layers, Network, Search, SearchX, Users, type LucideIcon } from 'lucide-react';
import { useWorkspaceData } from '../../state';
import { buildSearchIndex } from '../../utils/viewModels';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/StatusPill';
import { Portal } from '../ui/internal/Portal';
import { cx, useFocusTrap, useScrollLock } from '../ui/internal/utils';
import { useWsPath } from './workspacePath';

type Kind = 'person' | 'project' | 'tribe' | 'craft';
const GROUPS: Array<{ kind: Kind; label: string; icon: LucideIcon }> = [
  { kind: 'person', label: 'People', icon: Users },
  { kind: 'project', label: 'Projects', icon: FolderKanban },
  { kind: 'tribe', label: 'Tribes', icon: Network },
  { kind: 'craft', label: 'Crafts', icon: Layers },
];
const PER_GROUP = 5;

/** Where each result kind opens (SH-06#AC3). */
export function searchTarget(kind: Kind, id: string): string {
  const enc = encodeURIComponent(id);
  switch (kind) {
    case 'person':
      return `org/people?person=${enc}`;
    case 'project':
      return `org/projects?project=${enc}`;
    case 'tribe':
      return `org/tribes/${enc}`;
    case 'craft':
      return `org/people?craft=${enc}`;
  }
}

/** ⌘K / Ctrl K search over the snapshot: grouped People, Projects, Tribes, Crafts, max 5 each (SH-06). */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <SearchDialogBody onClose={onClose} />;
}

function SearchDialogBody({ onClose }: { onClose: () => void }) {
  const { snapshot } = useWorkspaceData();
  const navigate = useNavigate();
  const to = useWsPath();
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useFocusTrap(ref, true);
  useScrollLock(true);

  const search = useMemo(() => (snapshot ? buildSearchIndex(snapshot) : () => []), [snapshot]);
  const grouped = useMemo(() => {
    const all = search(query);
    const groups = GROUPS.map((g) => ({
      ...g,
      results: all.filter((r) => r.kind === g.kind).slice(0, PER_GROUP),
    })).filter((g) => g.results.length > 0);
    // Running offsets so each option has a stable flat index for aria-activedescendant.
    return groups.map((g, gi) => ({ ...g, offset: groups.slice(0, gi).reduce((n, x) => n + x.results.length, 0) }));
  }, [search, query]);
  const flat = grouped.flatMap((g) => g.results);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choose = (i: number) => {
    const r = flat[i];
    if (!r) return;
    onClose();
    navigate(to(searchTarget(r.kind, r.id)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  };

  return (
    <Portal>
      <div className="pcp-search-layer">
        <div className="pcp-scrim" aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          className="pcp-search-dialog"
          data-pcp-surface=""
        >
          <div className="pcp-search-dialog__input-row">
            <Icon icon={Search} size={20} className="pcp-search-dialog__icon" />
            <input
              data-autofocus=""
              className="pcp-search-dialog__input"
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={flat.length ? `${listId}-${active}` : undefined}
              aria-label="Search people, projects, tribes and crafts"
              placeholder="Search people, projects, tribes and crafts"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <Kbd>Esc</Kbd>
          </div>
          <div id={listId} role="listbox" aria-label="Results" className="pcp-search-dialog__results">
            {query.trim() === '' ? (
              <p className="pcp-search-dialog__hint">Type a name, project, tribe or craft code.</p>
            ) : flat.length === 0 ? (
              <div className="pcp-search-dialog__none">
                <Icon icon={SearchX} size={20} />
                <span>No results for “{query.trim()}”.</span>
              </div>
            ) : (
              grouped.map((g) => (
                <div key={g.kind} role="group" aria-label={g.label} className="pcp-search-dialog__group">
                  <div className="pcp-search-dialog__group-label" aria-hidden="true">
                    {g.label}
                  </div>
                  {g.results.map((r, ri) => {
                    const i = g.offset + ri;
                    return (
                      <div
                        key={`${r.kind}-${r.id}`}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        tabIndex={-1}
                        className={cx('pcp-search-dialog__option', i === active && 'pcp-search-dialog__option--active')}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(i)}
                        // Keyboard selection happens on the input (aria-activedescendant).
                        onKeyDown={() => undefined}
                      >
                        <Icon icon={g.icon} size={16} className="pcp-search-dialog__opt-icon" />
                        <span className="pcp-search-dialog__label">{r.label}</span>
                        {r.sublabel ? <span className="pcp-search-dialog__sub">{r.sublabel}</span> : null}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="pcp-search-dialog__footer" aria-hidden="true">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
            </span>
            <span>
              <Kbd>Enter</Kbd> to open
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
