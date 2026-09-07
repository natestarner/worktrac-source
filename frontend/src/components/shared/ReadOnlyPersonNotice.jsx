import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';

// Says, once and in words, why every control on this screen is greyed out: you are looking at
// someone else's training.
//
// ── WHY A NOTICE AND NOT JUST DISABLED CONTROLS ───────────────────────────────────────────────
// A member tapping a sibling's pill sees a screen where nothing responds. Greyed controls each
// carry a `title`, but this app is used on an iPad and an iPhone, where there is no hover and
// therefore no tooltip -- so on the primary devices the ONLY explanation would be the grey itself,
// which reads much more like the app being broken than like a rule. One sentence removes that.
//
// ── WHY IT STAYS IN FLOW ──────────────────────────────────────────────────────────────────────
// This is a PERSISTENT notice, not a transient one, so it takes the opposite placement from
// RefreshIndicator (portalled into the chrome precisely so it cannot move content). It is present
// for as long as the condition is, so the space it occupies is not a flicker -- the same call
// OfflineDataNotice's header makes and for the same reason.
//
// Renders nothing for an owner, or for a member looking at their own data, which is the overwhelming
// majority of renders.
export default function ReadOnlyPersonNotice() {
  const { activePersonId } = useAppState();
  const { people } = useAuth();
  const { canWritePerson } = useAccountAccess();

  if (canWritePerson(activePersonId)) return null;

  const person = people.find((p) => String(p.id) === String(activePersonId));

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-subtle-bg)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-muted)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {/* aria-hidden: the sentence beside it already says everything, and an announced glyph
          would just prefix every reading with "eye". */}
      <span aria-hidden="true">👀</span>
      <span>
        {/* Deliberately says what you CAN do, not what is withheld -- the same framing rule
            billing.md applies to the Free-tier window. "Viewing only" reads as a state; "you do
            not have permission" reads as a failure. */}
        Viewing {person ? person.name : 'someone else'}&rsquo;s workouts. You can look, but only
        your own are yours to change.
      </span>
    </div>
  );
}
