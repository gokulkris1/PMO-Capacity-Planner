/** CSV import of people and crafts (PPL-04): template, preview with per-row errors, then one import call. */
import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Download, FileUp } from 'lucide-react';
import type * as D from '../../../../shared/contracts/dto';
import type { PeopleImportResponse } from '../../../../shared/contracts/api';
import { useMutations } from '../../../../state';
import { Banner, Button, Checkbox, Dialog, StatusPill, downloadText, errorMessage } from '../../../plan/_kit';
import { peopleTemplateCsv, validatePeopleCsv } from './peopleCsv';

export function ImportPeopleDialog({
  snapshot: s,
  open,
  onClose,
}: {
  snapshot: D.WorkspaceSnapshot;
  open: boolean;
  onClose(): void;
}) {
  if (!open) return null;
  return <Inner s={s} onClose={onClose} />;
}

function Inner({ s, onClose }: { s: D.WorkspaceSnapshot; onClose(): void }) {
  const m = useMutations();
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PeopleImportResponse | null>(null);

  const parsed = useMemo(() => (text === null ? null : validatePeopleCsv(text, s)), [text, s]);
  const valid = parsed?.rows.filter((r) => r.errors.length === 0) ?? [];
  const invalid = parsed?.rows.filter((r) => r.errors.length > 0) ?? [];

  const onFile = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.size > 2_000_000) {
      setError('That file is larger than 2 MB. Split it and import in parts.');
      return;
    }
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.onerror = () => setError('We could not read that file.');
    reader.readAsText(f);
  };

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await m.people.importRows({ rows: valid.map((r) => r.row), createMissingStructure: createMissing });
      setResult(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Dialog
        open
        title="Import finished"
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="b2-stack b2-stack--sm">
          <Banner
            tone={result.errors.length ? 'warning' : 'success'}
            title={`${result.created} created, ${result.updated} updated, ${result.skipped} skipped`}
          />
          {result.errors.length > 0 && (
            <ul className="b2-list">
              {result.errors.map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      size="lg"
      title="Import people from CSV"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!parsed || valid.length === 0}
            loading={busy}
            onClick={() => void doImport()}
          >
            Import {valid.length} valid row{valid.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="b2-stack b2-stack--sm">
        <p className="b2-muted">
          People are matched by email, then by name, and updated; everyone else is created. Nothing is saved until you
          import.
        </p>
        <div className="b2-row b2-row--wrap">
          <Button size="sm" icon={Download} onClick={() => downloadText('people-template.csv', peopleTemplateCsv())}>
            Download template
          </Button>
          <label className="b2-btn b2-btn--secondary b2-btn--sm ip-file">
            <FileUp size={16} strokeWidth={1.75} aria-hidden="true" />
            {fileName ? 'Choose another file' : 'Choose CSV file'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="b2-sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {fileName && <span className="b2-caption">{fileName}</span>}
        </div>
        {error && <Banner tone="danger">{error}</Banner>}
        {parsed?.headerError && <Banner tone="danger">{parsed.headerError}</Banner>}
        {parsed && !parsed.headerError && (
          <>
            <div className="b2-row">
              <StatusPill tone="success" icon={CircleCheck}>
                {valid.length} valid
              </StatusPill>
              {invalid.length > 0 && (
                <StatusPill tone="danger" icon={CircleAlert}>
                  {invalid.length} with errors
                </StatusPill>
              )}
            </div>
            <div className="b2-table-wrap ip-preview">
              <table className="b2-table b2-table--compact">
                <caption className="b2-sr-only">Import preview</caption>
                <thead>
                  <tr>
                    <th scope="col" className="b2-num">
                      Row
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Action</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r) => (
                    <tr key={r.line}>
                      <td className="b2-num">{r.line}</td>
                      <th scope="row">{r.row.name || '—'}</th>
                      <td>{r.row.email ?? '—'}</td>
                      <td>{r.match === 'update' ? 'Update' : 'Create'}</td>
                      <td>
                        {r.errors.length === 0 ? (
                          <StatusPill tone="success">Valid</StatusPill>
                        ) : (
                          <span className="b2-field__error">
                            <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
                            {r.errors.join('; ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Checkbox
              checked={createMissing}
              onChange={setCreateMissing}
              label="Create missing chapters, teams and tribes"
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
