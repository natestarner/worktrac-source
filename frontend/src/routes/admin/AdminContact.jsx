import { useState } from 'react';
import { listContactMessages } from '../../api/admin';
import { useAdminData } from '../../hooks/useAdminData';
import { formatDateTime } from '../../utils/datetime';
import AdminTable from '../../components/admin/AdminTable';
import Skeleton from '../../components/shared/Skeleton';

// Read-only, deliberately -- there is no mark-read/archive/delete action here. /api/admin/**
// mutates app data in exactly two sanctioned places, and a third needs its own decision rather
// than arriving as a side effect of this feature.
//
// PENDING is styled as a warning rather than a neutral: a row that stays PENDING means the alert
// email never went out, so nobody was actually told about this message. That is precisely the
// "the task didn't run and it looks the same as success" blind spot the alert_status column exists
// to make visible, so it must not read as unremarkable.
const ALERT_TONES = {
  SENT: { bg: 'var(--color-success-bg)', fg: 'var(--color-success)' },
  PENDING: { bg: 'var(--color-warning-bg)', fg: 'var(--color-danger)' },
  FAILED: { bg: 'var(--color-danger-bg)', fg: 'var(--color-danger)' },
};

function AlertBadge({ status }) {
  const tone = ALERT_TONES[status] ?? ALERT_TONES.PENDING;
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
        background: tone.bg,
        color: tone.fg,
      }}
    >
      {status}
    </span>
  );
}

// The diagnostics are the reason this page is worth opening rather than just reading the alert
// email, so they get a real expandable panel instead of being crammed into a table cell.
function MessageRow({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{row.message}</div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="pressable"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          marginTop: 6,
          color: 'var(--color-accent-text)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {open ? 'Hide diagnostics' : 'Show diagnostics'}
      </button>
      {open && (
        <dl style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>
          <Detail label="Correlation id" value={row.correlationId} mono />
          <Detail label="App build" value={row.appBuild} />
          <Detail label="Screen" value={row.screen} />
          <Detail label="Connection" value={row.wasOnline === null ? null : row.wasOnline ? 'Online' : 'Offline'} />
          <Detail label="Unsynced writes" value={row.unsyncedWrites === null ? null : String(row.unsyncedWrites)} />
          <Detail label="Browser" value={row.userAgent} />
          <Detail label="IP" value={row.ipAddress} />
          <Detail label="Person" value={row.personName} />
          <Detail label="Account" value={row.accountName} />
          <Detail label="Last client error" value={row.clientError} mono />
          {/* The boot watchdog's record, when the app failed to start at all. Its first line says
              whether React ever rendered -- the question every white-screen investigation has had
              to open with and could never answer after the fact. */}
          <Detail label="Last failed start" value={row.bootFailure} mono />
          <Detail label="Alert detail" value={row.alertDetail} />
        </dl>
      )}
    </div>
  );
}

function Detail({ label, value, mono = false }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
      <dt style={{ minWidth: 130, flexShrink: 0 }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          color: 'var(--color-text)',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
          fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

const COLUMNS = [
  { key: 'createdAt', label: 'When', render: (row) => formatDateTime(row.createdAt) },
  { key: 'category', label: 'Type' },
  { key: 'submitterEmail', label: 'From' },
  { key: 'subject', label: 'Subject', wrap: true },
  // wrap: true or the whole message renders on one nowrap line and the table scrolls sideways
  // forever -- see AdminTable's `col.wrap`.
  { key: 'message', label: 'Message', wrap: true, render: (row) => <MessageRow row={row} /> },
  { key: 'alertStatus', label: 'Alert', render: (row) => <AlertBadge status={row.alertStatus} /> },
];

export default function AdminContact() {
  const { data, loading, error } = useAdminData(listContactMessages);

  if (loading) return <Skeleton />;
  if (error) return <div style={{ color: 'var(--color-danger)' }}>{error}</div>;

  return (
    <AdminTable
      columns={COLUMNS}
      rows={data ?? []}
      rowKey={(row) => row.id}
      emptyMessage="No messages yet."
    />
  );
}
