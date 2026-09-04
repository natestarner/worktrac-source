import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createPastSession } from '../../api/sessions';
import { queryKeys } from '../../api/queryKeys';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';
import { localDateTimeToIso, localDateTimeToMs, toLocalDateStr, toLocalTimeStr } from '../../utils/datetime';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';
import ProUpsell from '../shared/ProUpsell';
import { windowLabel } from '../shared/historyWindowCopy';

export default function PastSessionModal({ onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activePersonId, startEditingSession } = useAppState();
  const { people, account } = useAuth();
  const { online, run } = useGatedMutation();
  const { historyWindow } = useHistoryWindow(activePersonId);
  const activePersonName = people.find((p) => p.id === activePersonId)?.name || '';

  const now = new Date().toISOString();
  const [date, setDate] = useState(toLocalDateStr(now));
  const [time, setTime] = useState(toLocalTimeStr(now));

  // Warn, never block. The workout genuinely is saved and comes back on upgrade, so putting a `min`
  // on the input would turn a DISPLAY limit into a data-entry limit -- the app refusing to record
  // something that actually happened, which is the opposite of "nothing is deleted, ever".
  //
  // The boundary comes from the server's windowStart, never a client-side 90 days, so this warning
  // and the clamp it describes cannot disagree. An unknown window (Pro, or no answer yet) means no
  // warning: windowStart is non-null for every Free household, so absence here is never a Free
  // household being silently missed.
  //
  // Compared as epoch millis rather than as ISO strings: the two sides are formatted by different
  // writers (Date#toISOString always emits milliseconds, Jackson's Instant does not), so a
  // lexicographic comparison would disagree with the server at the exact boundary.
  const windowStart = historyWindow?.windowStart;
  const chosenAtMs = localDateTimeToMs(date, time);
  const outsideWindow =
    Boolean(windowStart) && chosenAtMs !== null && chosenAtMs < new Date(windowStart).getTime();

  // Online-only (Tier 3): createPastSession has no idempotency key, so a queued offline replay would
  // duplicate the session -- gate it rather than let it queue. Retroactive entry is a sit-at-home
  // action anyway, never done mid-workout with no signal.
  const handleStart = run(async () => {
    const iso = localDateTimeToIso(date, time);
    const session = await createPastSession(activePersonId, iso);
    // The new (empty) session belongs in this person's History immediately.
    queryClient.invalidateQueries({ queryKey: queryKeys.history(activePersonId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.historyWindow(activePersonId) });
    startEditingSession(session);
    onClose();
    navigate('/app/log');
  }, {
    offlineMessage: 'You need a connection to log a past workout.',
    errorMessage: "Couldn't start that past workout.",
  });

  // initialFocus="dialog": the first control here is <input type="date">, and focusing it makes the
  // browser highlight its month segment -- so the modal opened with a stray selected number in the
  // date, which reads as a glitch. See Modal.jsx for why this is not an a11y downgrade.
  return (
    <Modal width={340} onClose={onClose} title="Log a past workout" initialFocus="dialog">
      <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 18 }}>When did {activePersonName} work out?</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          // 16px avoids iOS Safari's input-zoom -- see ExercisePicker.jsx's fontSize comment.
          style={{ flex: 1, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 16 }}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{ flex: 1, padding: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 16 }}
        />
      </div>
      {outsideWindow && (
        <div style={{ marginBottom: 12 }}>
          <ProUpsell plan={account?.plan}>
            That&rsquo;s outside {windowLabel(windowStart)}, which is what History, PRs and Trends
            show on Free. The workout still saves to your full history.
          </ProUpsell>
        </div>
      )}
      {!online && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>
          Logging a past workout needs a connection.
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleStart}
          disabled={!online}
          style={{
            flex: 1,
            padding: 14,
            background: online ? 'var(--color-accent)' : 'var(--color-faint)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 15,
            fontWeight: 700,
            cursor: online ? 'pointer' : 'not-allowed',
          }}
        >
          Start adding sets
        </Button>
      </div>
    </Modal>
  );
}
