// The styles the six unauthenticated screens share -- login, register, confirm-email, forgot
// password, reset password and join -- plus the household picker they can both land on.
//
// These lived as exports on LoginPage.jsx, which was fine while LoginPage was the only thing that
// owned a shared piece of that chrome. It stopped being fine when HouseholdPicker moved out into
// its own component: LoginPage renders the picker, so the picker importing a style back out of
// LoginPage is an import cycle. It happens to resolve today (the constants are only read inside a
// component body, by which point both modules have evaluated), and that is precisely the kind of
// accident that breaks on a bundler's next reorder.
//
// inputStyle stays a thin wrapper over the .input class rather than a replacement for it: those
// pages compose it with per-field overrides, and the 16px font size lives in the class and must
// stay there or iOS Safari zooms the viewport on focus.

export const inputStyle = {
  marginBottom: 'var(--space-3)',
};

export const primaryButtonStyle = {
  marginTop: 'var(--space-2)',
};

export const fieldLabelStyle = {
  display: 'block',
  marginBottom: 'var(--space-1)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-label)',
};

const bannerBase = {
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3) var(--space-4)',
  fontSize: 'var(--text-sm)',
  marginBottom: 'var(--space-4)',
  textAlign: 'left',
  border: '1px solid transparent',
};

export const successBannerStyle = {
  ...bannerBase,
  background: 'var(--color-success-bg)',
  borderColor: 'var(--color-success)',
  color: 'var(--color-text)',
};

// Was rendering on --color-pr-bg -- the personal-record celebration peach. A failure and an
// achievement must never share a colour.
export const errorBannerStyle = {
  ...bannerBase,
  background: 'var(--color-danger-bg)',
  borderColor: 'var(--color-danger-border)',
  color: 'var(--color-danger)',
};

// The card every one of these screens is drawn on.
export const authCardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-xl)',
  padding: 'var(--space-10) var(--space-8)',
  width: 560,
  maxWidth: '92vw',
  textAlign: 'center',
  boxShadow: 'var(--shadow-2), var(--elevation-hairline)',
};

export const authPageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--color-bg)',
};
