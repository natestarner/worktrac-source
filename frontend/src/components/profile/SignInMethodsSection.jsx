import { useQueryClient } from '@tanstack/react-query';
import SectionLabel from '../shared/SectionLabel';
import OfflineDisabledWrap from '../shared/OfflineDisabledWrap';
import ProviderButtons from '../auth/ProviderButtons';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useSignInMethods } from '../../hooks/useSignInMethods';
import { queryKeys } from '../../api/queryKeys';
import { connectSignInMethod } from '../../api/socialSignIn';
import { availableSignInProviders } from '../../lib/native';

const NAMES = { apple: 'Apple', google: 'Google', test: 'Test provider' };

/**
 * "Sign in with": which Apple / Google accounts can sign in to MY login, and connecting or
 * disconnecting one. Every role sees it for their own login (MANAGE_OWN_SIGN_IN_METHODS); there is
 * no way to touch anyone else's, for the reason an owner can't set a member's password.
 *
 * Renders nothing until the methods have loaded, and nothing at all where there is nothing to show
 * (no provider configured here and none connected) -- so production, until launch, is unchanged.
 *
 * Both writes are online-only: connecting needs the provider's sheet, and disconnecting MINTS a
 * replacement session (it signs out every other device), so there is nothing to queue.
 */
export default function SignInMethodsSection() {
  const { user, disconnectSignInMethod } = useAuth();
  const { showToast, openConfirm } = useUI();
  const queryClient = useQueryClient();
  const { data } = useSignInMethods();
  const { online, pending, run } = useGatedMutation({ showServerMessage: true });

  if (!data) return null;
  const connected = data.connected ?? [];
  const connectedProviders = connected.map((c) => c.provider);
  const offerable = availableSignInProviders().filter(
    (p) => (data.available ?? []).includes(p) && !connectedProviders.includes(p),
  );
  if (connected.length === 0 && offerable.length === 0) return null;

  const onlyWayIn = !data.hasPassword && connected.length === 1;

  const connect = (provider, token) =>
    run(
      async () => {
        const updated = await connectSignInMethod(provider, { idToken: token.idToken, nonce: token.nonce });
        queryClient.setQueryData(queryKeys.signInMethods(user?.id), updated);
        showToast(`${NAMES[provider]} connected. You can sign in with it now.`);
      },
      {
        offlineMessage: 'Connecting needs a connection.',
        errorMessage: `Couldn't connect ${NAMES[provider]}.`,
      },
    )();

  const disconnect = (provider) =>
    openConfirm(
      `Disconnect ${NAMES[provider]}? You'll stay signed in here, and every other device signed in as you will be signed out.`,
      run(
        async () => {
          await disconnectSignInMethod(provider);
          await queryClient.invalidateQueries({ queryKey: queryKeys.signInMethods(user?.id) });
          showToast(`${NAMES[provider]} disconnected.`);
        },
        {
          offlineMessage: 'Disconnecting needs a connection.',
          errorMessage: `Couldn't disconnect ${NAMES[provider]}.`,
        },
      ),
      { confirmLabel: 'Disconnect' },
    );

  return (
    <>
      <SectionLabel>Sign in with</SectionLabel>
      <div style={cardStyle}>
        {connected.map((c) => (
          <div key={c.provider} style={rowStyle}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{NAMES[c.provider] ?? c.provider}</div>
              <div style={hintStyle}>
                {onlyWayIn
                  ? 'Your only way to sign in. Set a password before disconnecting it.'
                  : `Connected ${formatDate(c.connectedAt)}`}
              </div>
            </div>
            {!onlyWayIn && (
              <OfflineDisabledWrap message="Disconnecting needs a connection.">
                <button
                  type="button"
                  className="pressable"
                  disabled={!online || pending}
                  onClick={() => disconnect(c.provider)}
                  style={linkStyle}
                  aria-label={`Disconnect ${NAMES[c.provider] ?? c.provider}`}
                >
                  Disconnect
                </button>
              </OfflineDisabledWrap>
            )}
          </div>
        ))}
        {offerable.length > 0 && (
          <div style={{ marginTop: connected.length > 0 ? 'var(--space-4)' : 0 }}>
            <div style={{ ...hintStyle, marginBottom: 'var(--space-3)' }}>
              Sign in with one tap. Your password keeps working too.
            </div>
            <OfflineDisabledWrap message="Connecting needs a connection.">
              <ProviderButtons
                only={offerable}
                verb="Connect"
                disabled={!online || pending}
                onToken={connect}
                onError={() => showToast("Couldn't reach the sign-in service. Try again.")}
              />
            </OfflineDisabledWrap>
          </div>
        )}
      </div>
    </>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
  marginBottom: 'var(--space-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' };
const labelStyle = { fontSize: 15, fontWeight: 600 };
const hintStyle = { fontSize: 13, color: 'var(--color-muted)', marginTop: 2 };
const linkStyle = {
  background: 'none',
  border: 'none',
  padding: 0,
  minHeight: 44,
  color: 'var(--color-accent-text)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
