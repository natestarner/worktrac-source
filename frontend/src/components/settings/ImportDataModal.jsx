import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { commitImport, previewImport } from '../../api/dataImport';
import { invalidateAfterImport } from '../../lib/queryClient';
import Modal from '../shared/Modal';
import Button from '../shared/Button';
import { cancelButtonStyle } from '../shared/ConfirmDialog';

// Reading a workout CSV (or the same layout as an .xlsx) into one person's history.
//
// Online-only (Tier 3), like every other bulk/retroactive write: it is a whole-history write with
// no idempotency key on the wire, and queueing it would fire against data that has changed
// underneath it. What keeps a refusal from costing anything is that the modal stays open with the
// file, the person and the preview intact -- re-picking a file the person still has on disk is not
// the same loss as re-typing a Contact Us message, which is what PERSON_DEFAULTS.contactDraft
// exists for. Deliberately NOT persisted to localStorage: a multi-megabyte CSV would blow the
// quota that appStatePersistence and outboxSequence depend on.
//
// Preview then commit, always. The file is posted twice rather than the server holding parse state
// between them; recomputing duplicates at commit time against live data is what makes the commit
// safe to retry.
const MAX_VISIBLE_ERRORS = 20;

export default function ImportDataModal({ onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { people } = useAuth();
  const { activePersonId, selectPerson } = useAppState();
  const { online, pending, run } = useGatedMutation();

  const [targetPersonId, setTargetPersonId] = useState(activePersonId);
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState(null);
  const [sheetName, setSheetName] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [reading, setReading] = useState(false);

  const targetName = people.find((p) => p.id === targetPersonId)?.name || 'this person';

  async function handleFileChosen(event) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setPreview(null);
    setResult(null);
    setFileError(null);
    setSheetName(null);
    setReading(true);

    try {
      let text;
      let sheet = null;
      // Branching on FILE TYPE, not connectivity -- this is not a register entry.
      if (chosen.name.toLowerCase().endsWith('.xlsx')) {
        const { workbookToCsv } = await import('../../utils/workbookToCsv');
        const converted = await workbookToCsv(chosen);
        text = converted.csv;
        sheet = converted.sheetName;
      } else {
        text = await chosen.text();
      }
      setCsv(text);
      setSheetName(sheet);
      await previewFor(targetPersonId, text, chosen.name);
    } catch (error) {
      setCsv(null);
      setFileError(error?.message || "That file couldn't be read.");
    } finally {
      setReading(false);
    }
  }

  // Takes the person explicitly rather than reading targetPersonId, because handlePersonChange
  // needs to preview against the NEW person in the same tick the state is set -- and which rows
  // count as duplicates depends entirely on whose history they are compared against.
  const previewFor = run(
    async (personId, text, filename) => {
      const summary = await previewImport(personId, text, filename);
      setPreview(summary);
    },
    {
      offlineMessage: 'You need a connection to import data.',
      errorMessage: "Couldn't read that file.",
    },
  );

  async function handlePersonChange(event) {
    const nextId = Number(event.target.value);
    setTargetPersonId(nextId);
    setPreview(null);
    setResult(null);
    if (csv) {
      await previewFor(nextId, csv, file?.name);
    }
  }

  const handleImport = run(
    async () => {
      const summary = await commitImport(targetPersonId, csv, file?.name);
      invalidateAfterImport(queryClient, targetPersonId);
      setResult(summary);
    },
    {
      offlineMessage: 'You need a connection to import data.',
      // The modal stays open on failure with everything still selected, so this costs a tap.
      errorMessage: "Couldn't import that file.",
    },
  );

  function handleViewHistory() {
    selectPerson(targetPersonId);
    onClose();
    navigate('/app/history');
  }

  if (result) {
    return (
      <Modal width={420} onClose={onClose} title="Import complete">
        <div style={{ fontSize: 14, color: 'var(--color-text)', marginBottom: 'var(--space-4)' }}>
          Added <strong>{result.setCount}</strong> {result.setCount === 1 ? 'set' : 'sets'} across{' '}
          <strong>{result.sessionCount}</strong> {result.sessionCount === 1 ? 'workout' : 'workouts'} to {targetName}
          &rsquo;s history.
        </div>
        <Summary summary={result} targetName={targetName} sheetName={sheetName} />
        <div style={{ display: 'flex', gap: 10, marginTop: 'var(--space-5)' }}>
          <button onClick={onClose} style={cancelButtonStyle}>
            Done
          </button>
          <Button variant="primary" style={{ flex: 1 }} onClick={handleViewHistory}>
            View {targetName}&rsquo;s history
          </Button>
        </div>
        {result.batchId != null && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 'var(--space-4)', textAlign: 'center' }}>
            Changed your mind? Undo this import from the Data section in App Settings.
          </div>
        )}
      </Modal>
    );
  }

  const importable = preview ? preview.setCount : 0;
  const rowErrorCount = preview ? preview.rowErrors.length : 0;
  const nothingToDo = preview != null && importable === 0;

  return (
    <Modal width={420} onClose={onClose} title="Import data">
      <label htmlFor="import-person" style={labelStyle}>
        Import into
      </label>
      <select
        id="import-person"
        value={targetPersonId}
        onChange={handlePersonChange}
        style={selectStyle}
      >
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>

      <label htmlFor="import-file" style={{ ...labelStyle, marginTop: 'var(--space-5)' }}>
        Choose a file
      </label>
      <input
        id="import-file"
        type="file"
        accept=".csv,.xlsx,text/csv"
        onChange={handleFileChosen}
        style={fileInputStyle}
      />

      <WhatGetsImported />

      {reading && <div style={noticeStyle}>Reading {file?.name}&hellip;</div>}

      {fileError && (
        <div role="alert" style={{ ...noticeStyle, color: 'var(--color-danger)', fontWeight: 600 }}>
          {fileError}
        </div>
      )}

      {/* Announced rather than silently appearing -- the result is the whole point of the step. */}
      <div aria-live="polite">
        {preview && (
          <>
            <div style={{ fontSize: 14, color: 'var(--color-text)', marginBottom: 'var(--space-3)' }}>
              {nothingToDo ? (
                <>
                  Nothing to import &mdash; all {preview.skippedDuplicateCount}{' '}
                  {preview.skippedDuplicateCount === 1 ? 'row is' : 'rows are'} already in {targetName}
                  &rsquo;s history.
                </>
              ) : (
                <>
                  <strong>{preview.setCount}</strong> {preview.setCount === 1 ? 'set' : 'sets'} across{' '}
                  <strong>{preview.sessionCount}</strong>{' '}
                  {preview.sessionCount === 1 ? 'workout' : 'workouts'} will be added to {targetName}
                  &rsquo;s history.
                </>
              )}
            </div>
            <Summary summary={preview} targetName={targetName} sheetName={sheetName} />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 'var(--space-5)' }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          variant="primary"
          style={{ flex: 1 }}
          onClick={handleImport}
          disabled={!online || pending || reading || !preview || nothingToDo}
        >
          {buttonLabel(importable, rowErrorCount, targetName)}
        </Button>
      </div>
      {!online && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 'var(--space-3)' }}>
          Importing needs a connection.
        </div>
      )}
    </Modal>
  );
}

// The count on the button is what will actually happen, never the file's row count -- someone
// should not press "Import 42" and get 40.
function buttonLabel(importable, rowErrorCount, targetName) {
  if (importable === 0) return 'Import';
  const total = importable + rowErrorCount;
  const noun = importable === 1 ? 'set' : 'sets';
  if (rowErrorCount > 0) {
    return `Import ${importable} of ${total} rows`;
  }
  return `Import ${importable} ${noun} into ${targetName}`;
}

// Everything the preview found that isn't the headline count: what was assumed, what was skipped,
// what isn't coming across, and which rows can't be read. A default nobody is shown is a silent
// guess, which is the thing this panel exists to prevent.
function Summary({ summary, targetName, sheetName }) {
  const notes = [];
  if (sheetName) notes.push(`Read sheet "${sheetName}".`);
  if (summary.skippedDuplicateCount > 0 && summary.setCount > 0) {
    notes.push(
      `${summary.skippedDuplicateCount} ${summary.skippedDuplicateCount === 1 ? 'row is' : 'rows are'} already in ${targetName}'s history and will be skipped.`,
    );
  }
  if (summary.newExerciseNames.length > 0 || summary.newTagNames.length > 0) {
    const parts = [];
    if (summary.newExerciseNames.length > 0) {
      parts.push(`${summary.newExerciseNames.length} ${summary.newExerciseNames.length === 1 ? 'exercise' : 'exercises'}`);
    }
    if (summary.newTagNames.length > 0) {
      parts.push(`${summary.newTagNames.length} ${summary.newTagNames.length === 1 ? 'tag' : 'tags'}`);
    }
    // Exercises and tags are account-scoped, so this is the one household-wide effect of a
    // per-person import. Saying so beats someone discovering it in another person's picker.
    notes.push(`${parts.join(' and ')} will be added to your household's shared lists.`);
  }
  if (summary.notesSkipped > 0) {
    notes.push(`${summary.notesSkipped} exercise ${summary.notesSkipped === 1 ? 'note' : 'notes'} already exist and won't be replaced.`);
  }
  for (const applied of summary.appliedDefaults) notes.push(applied);
  if (summary.ignoredColumns.length > 0) {
    notes.push(`Not imported: ${summary.ignoredColumns.join(', ')}.`);
  }

  const visibleErrors = summary.rowErrors.slice(0, MAX_VISIBLE_ERRORS);
  const hiddenErrors = summary.rowErrors.length - visibleErrors.length;

  return (
    <>
      {notes.length > 0 && (
        <ul style={noteListStyle}>
          {notes.map((note) => (
            <li key={note} style={{ marginBottom: 4 }}>
              {note}
            </li>
          ))}
        </ul>
      )}
      {summary.rowErrors.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-danger)', marginBottom: 6 }}>
            {summary.rowErrors.length} {summary.rowErrors.length === 1 ? 'row' : 'rows'} can&rsquo;t be read
          </div>
          {/* Capped and scrollable: a file with 500 problems would otherwise push the primary
              action off the bottom of a phone screen. */}
          <ul style={errorListStyle}>
            {visibleErrors.map((error) => (
              <li key={`${error.line}-${error.message}`} style={{ marginBottom: 4 }}>
                <strong>Line {error.line}:</strong> {error.message}
              </li>
            ))}
          </ul>
          {hiddenErrors > 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>&hellip;and {hiddenErrors} more.</div>
          )}
        </div>
      )}
    </>
  );
}

// The contract, before a file is chosen rather than after it fails. Same disclosure pattern as
// ContactTab's WhatGetsSent, and collapsed for the same reason: it must be findable without
// crowding the one control that matters.
function WhatGetsImported() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable"
        style={discloseButtonStyle}
      >
        What the file needs {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={discloseBodyStyle}>
          <p style={{ margin: 0, marginBottom: 'var(--space-3)' }}>
            A CSV or Excel file with a heading row. Three columns are required:
          </p>
          <ul style={{ margin: 0, marginBottom: 'var(--space-3)', paddingLeft: 18 }}>
            <li>
              <strong>Exercise</strong>
            </li>
            <li>
              <strong>Date</strong>
            </li>
            <li>
              <strong>Reps</strong> or <strong>Duration (sec)</strong>
            </li>
          </ul>
          <p style={{ margin: 0, marginBottom: 'var(--space-3)' }}>
            Everything else is optional: <em>Time</em> (else midday), <em>Weight</em> (else bodyweight),{' '}
            <em>Unit</em> (else your account default), <em>Session Start</em> (else one workout per day),{' '}
            <em>Session Type</em>, <em>Set #</em>, <em>Rest (sec)</em>, <em>Session Note</em>,{' '}
            <em>Exercise Note</em>, <em>Favorite</em> and <em>Tags</em>. Custom Fields and Est. 1RM aren&rsquo;t
            imported.
          </p>
          <p style={{ margin: 0, marginBottom: 'var(--space-3)' }}>
            Importing only ever <strong>adds</strong>. Nothing already in your history is changed or deleted,
            and rows you already have are skipped.
          </p>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>
            Not sure of the format? Export your data first and use that file as a template.
          </p>
        </div>
      )}
    </div>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  marginBottom: 6,
};

// 16px, like every other input: anything smaller makes iOS Safari zoom the viewport on focus.
const selectStyle = {
  width: '100%',
  padding: 12,
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 16,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  minHeight: 44,
};

const fileInputStyle = {
  width: '100%',
  fontSize: 16,
  color: 'var(--color-text)',
  minHeight: 44,
};

const noticeStyle = {
  fontSize: 13,
  color: 'var(--color-muted)',
  marginBottom: 'var(--space-3)',
};

const noteListStyle = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 13,
  color: 'var(--color-muted)',
  lineHeight: 'var(--leading-normal)',
};

const errorListStyle = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 13,
  color: 'var(--color-muted)',
  lineHeight: 'var(--leading-normal)',
  maxHeight: 180,
  overflowY: 'auto',
};

const discloseButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  minHeight: 40,
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};

const discloseBodyStyle = {
  marginTop: 'var(--space-2)',
  padding: 'var(--space-3)',
  background: 'var(--color-subtle-bg)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text)',
  lineHeight: 'var(--leading-normal)',
};
