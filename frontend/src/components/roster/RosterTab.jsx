import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { queryKeys } from '../../api/queryKeys';
import { listRoster } from '../../api/roster';
import { accountVocab, capitalize } from '../../utils/accountVocab';
import SectionLabel from '../shared/SectionLabel';
import Card from '../shared/Card';
import Skeleton from '../shared/Skeleton';
import EmptyState from '../shared/EmptyState';

/**
 * The roster — everyone on the account, quietest first.
 *
 * A family has a person switcher and needs nothing more. A trainer with forty clients has one
 * recurring question, and it is always the same one: who has stopped showing up? The server does
 * the ordering (RosterService) so the answer is at the top rather than found by scrolling.
 *
 * ⚠️ THE SORT IS THE SERVER'S, AND MUST STAY THERE. Re-sorting here would mean two orderings of the
 * same list, and the client's would be computed against the device's own clock -- which on a phone
 * with a wrong date reorders the one screen whose entire purpose is the order.
 */
export default function RosterTab() {
  const navigate = useNavigate();
  const { account, people } = useAuth();
  const vocab = accountVocab(account?.vocab);

  const { data: roster, isLoading, isError } = useQuery({
    queryKey: queryKeys.roster(undefined),
    queryFn: () => listRoster(),
  });

  // ⚠️ THE OWNER IS NOT ONE OF THEIR OWN CLIENTS. RosterService reads through PersonService.list,
  // which returns every person the caller can see -- including the trainer's own training profile,
  // since visibility (not "is this a client") is the question it answers. Filtering here, rather
  // than asking the server to exclude the owner, keeps this the same "no plan gate, filter is
  // presentation" shape the rest of this screen already has.
  //
  // Matched by the PRIMARY person, not by the viewer's own identity: useAccountAccess().selfPersonId
  // is null for an OWNER by design (frontend-core.md), and a manager (assistant) viewing this same
  // list must not see the trainer counted as their own client either. `people` is undefined on an
  // older auth snapshot or a still-booting render, and no `people` means no owner to identify --
  // fails open to showing everyone, same direction as every other unknown-state default in this app.
  const ownerPersonId = people?.find((p) => p.isPrimary)?.id;
  const clients = roster?.filter((entry) => String(entry.personId) !== String(ownerPersonId));

  return (
    <div>
      <button onClick={() => navigate(-1)} style={backButtonStyle}>
        &larr; Back
      </button>

      <SectionLabel>{capitalize(vocab.member)}s</SectionLabel>

      {isLoading && (
        <Card size="dense" style={{ marginBottom: 24 }}>
          <Skeleton height={18} style={{ marginBottom: 12 }} />
          <Skeleton height={18} style={{ marginBottom: 12 }} />
          <Skeleton height={18} />
        </Card>
      )}

      {/* A read with nothing cached behind it. Saying so beats a spinner over a request that will
          not succeed, and beats an empty roster, which would read as "nobody is here". */}
      {isError && !roster && (
        <Card size="dense" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, color: 'var(--color-muted)' }}>
            Couldn&rsquo;t load your {vocab.member}s just now. This screen works offline once
            it&rsquo;s loaded at least once.
          </div>
        </Card>
      )}

      {clients && clients.length === 0 && (
        <EmptyState title={`No ${vocab.member}s yet`} body={`Add one from App Settings, or invite them to their own login.`} />
      )}

      {clients && clients.length > 0 && (
        <Card flush style={{ marginBottom: 24 }}>
          {clients.map((entry, index) => (
            <RosterRow
              key={entry.personId}
              entry={entry}
              vocab={vocab}
              last={index === clients.length - 1}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

function RosterRow({ entry, vocab, last }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        borderBottom: last ? 'none' : '1px solid var(--color-border)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)' }}>
          {entry.personName}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 2 }}>
          {describeActivity(entry, vocab)}
        </div>
      </div>
      {/* The number a trainer scans down the column for. Rendered as its own element rather than
          folded into the sentence above so the eye can run down it. */}
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
        {entry.sessionsInWindow} in 4 wks
      </div>
    </div>
  );
}

/**
 * The row's own sentence.
 *
 * ⚠️ "Never" is its own case, not "a very long time ago". `daysSinceLastWorkout` is null for
 * somebody who has never logged anything precisely so this cannot render a number for them --
 * the server deliberately sends no sentinel for the same reason.
 */
function describeActivity(entry, vocab) {
  if (entry.daysSinceLastWorkout == null) {
    return entry.hasLogin
      ? 'Has never logged a workout'
      : `No workouts yet — this ${vocab.member} has no login`;
  }

  const when = entry.daysSinceLastWorkout === 0
    ? 'Trained today'
    : entry.daysSinceLastWorkout === 1
      ? 'Trained yesterday'
      : `Last trained ${entry.daysSinceLastWorkout} days ago`;

  if (entry.currentStreakWeeks > 0) {
    const weeks = entry.currentStreakWeeks === 1 ? 'week' : 'weeks';
    return `${when} · ${entry.currentStreakWeeks} ${weeks} running`;
  }
  return when;
}

const backButtonStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  marginBottom: 'var(--space-3)',
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  cursor: 'pointer',
};
