import logoLight from '../../assets/huddle-lockup-vertical-onlight.svg';
import logoDark from '../../assets/huddle-lockup-vertical-ondark.svg';
import { authCardStyle, authPageStyle, errorBannerStyle } from './authStyles';

/**
 * "Which household?" — shown between a proved credential and a live session.
 *
 * TWO screens land here, and that is the whole point of it being one component:
 *
 * 1. **Signing in** with a credential that belongs to more than one household (`LoginPage`).
 * 2. **Accepting an invitation** as somebody who already had a household (`JoinPage`) — which now
 *    leaves them with two, so this is exactly the screen they would have seen on their very next
 *    sign-in anyway. Reusing it is what keeps joining from needing a journey of its own: no toast,
 *    no confirmation screen, no automatic jump into a household nobody asked to be moved to.
 *
 * Both callers hand it the same `{ households, selectionToken }` the server returned, and both
 * finish through `AuthContext.chooseHousehold` — so the two cannot drift on what picking means.
 *
 * Deliberately a plain list of buttons rather than a select: on a phone two or three big targets
 * beat a dropdown, and the whole screen exists to be tapped once.
 *
 * `onCancel` is optional. On the login page it means "use a different login" and backs out to the
 * form. On the join page there is nothing to back out to — the membership is already attached and
 * the credential is already proved — so it is either omitted or points somewhere that makes sense
 * for a visitor who was already signed in.
 */
export default function HouseholdPicker({
  households,
  onChoose,
  onCancel,
  cancelLabel = 'Use a different login',
  heading = 'Choose a household',
  intro = 'You’re part of more than one. You can switch later from the account menu.',
  submitting,
  error,
}) {
  return (
    <main style={authPageStyle}>
      <div style={authCardStyle}>
        <picture>
          <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
          <img
            src={logoLight}
            alt="Huddle"
            style={{ width: 216, maxWidth: '100%', height: 'auto', marginBottom: 32 }}
          />
        </picture>

        <h1 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>{heading}</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-6)' }}>
          {intro}
        </p>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {households.map((household) => (
            <button
              key={household.accountId}
              type="button"
              disabled={submitting}
              onClick={() => onChoose(household.accountId)}
              className="btn btn-lg btn-full pressable"
              style={{
                background: 'var(--color-subtle-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                textAlign: 'left',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}
            >
              {/* .btn sets white-space: nowrap for ordinary short labels, which this composite
                  one isn't -- a long household name plus the role label together can exceed the
                  row's width. Flex items default to min-width: auto, so without overriding both,
                  the name refuses to shrink or wrap and pushes the role label past the button
                  (and on a narrow phone, past the card) instead of wrapping. */}
              <span style={{ fontWeight: 'var(--weight-semibold)', whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: 0, flex: '1 1 auto' }}>
                {household.accountName}
              </span>
              {/* Their own role, not a badge about the household -- it is the fastest way to tell
                  "the one I run" from "the one I was invited to" when both are named after a
                  family. */}
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textTransform: 'lowercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {household.accountRole === 'OWNER' ? 'you own this' : 'you’re a member'}
              </span>
            </button>
          ))}
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              marginTop: 'var(--space-5)',
              background: 'none',
              border: 'none',
              color: 'var(--color-muted)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
        )}
      </div>
    </main>
  );
}
