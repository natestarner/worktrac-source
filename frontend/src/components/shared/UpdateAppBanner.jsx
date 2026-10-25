import { useAuth } from '../../context/AuthContext';
import { NATIVE_BUILD_NUMBER } from '../../lib/appBuild';
import { externalLinkProps } from '../../lib/native';

// "This version of Huddle is out of date" -- shown only in an App Store build older than the
// minimum the server says it still supports (/me's `client.minSupportedNativeBuild`, kept in the
// auth snapshot so an offline open remembers the last minimum it was told).
//
// A BANNER, never a gate, and it touches nothing: no write is refused, nothing in the outbox is
// discarded or paused, and logging carries on. Anything queued drains exactly as before, and keeps
// draining after the update -- the outbox is in WebKit storage, which a store update keeps.
// Updates are the person's to make; the most this may do is ask.
//
// Not a platform branch: the web has no build number (NATIVE_BUILD_NUMBER is null), so the
// comparison is simply false there -- one code path, decided by data.
export function isBelowMinimum(build, minimum) {
  return Number.isInteger(build) && Number.isInteger(minimum) && minimum > 0 && build < minimum;
}

export default function UpdateAppBanner({ build = NATIVE_BUILD_NUMBER }) {
  const { client } = useAuth();
  if (!isBelowMinimum(build, client?.minSupportedNativeBuild)) return null;

  const storeUrl = client?.appStoreUrl;
  return (
    <div role="status" aria-live="polite" style={bannerStyle}>
      <span>
        This version of Huddle is out of date. Update it from the App Store to keep everything
        working. Nothing you&rsquo;ve logged is lost.
      </span>
      {storeUrl ? (
        // leaveApp: handed to iOS, the listing opens in the App Store itself rather than as a web
        // preview in the in-app browser sheet.
        <a {...externalLinkProps(storeUrl, { leaveApp: true })} className="pressable" style={linkStyle}>
          Update
        </a>
      ) : null}
    </div>
  );
}

const bannerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-4)',
  background: 'var(--color-warning-bg)',
  color: 'var(--color-warning-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  borderBottom: '1px solid var(--color-warning-border)',
  textAlign: 'center',
};

const linkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  padding: '0 var(--space-4)',
  borderRadius: 'var(--radius-full)',
  background: 'var(--color-warning-text)',
  color: 'var(--color-warning-bg)',
  fontWeight: 'var(--weight-bold)',
  textDecoration: 'none',
};
