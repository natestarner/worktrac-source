import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UpdateAppBanner, { isBelowMinimum } from './UpdateAppBanner';
import { useAuth } from '../../context/AuthContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

beforeEach(() => {
  useAuth.mockReset();
});

describe('isBelowMinimum', () => {
  it('is true only for an app build older than a real minimum', () => {
    expect(isBelowMinimum(56, 57)).toBe(true);
    expect(isBelowMinimum(57, 57)).toBe(false);
    expect(isBelowMinimum(58, 57)).toBe(false);
  });

  // The web has no build number, a server that never set one sends 0, and a snapshot from before
  // the field existed has none. None of those is "out of date".
  it('is false on the web, for an unset minimum, and for an unknown minimum', () => {
    expect(isBelowMinimum(null, 57)).toBe(false);
    expect(isBelowMinimum(1, 0)).toBe(false);
    expect(isBelowMinimum(1, undefined)).toBe(false);
  });
});

describe('UpdateAppBanner', () => {
  it('says the app is out of date, and that nothing logged is lost', () => {
    useAuth.mockReturnValue({ client: { minSupportedNativeBuild: 57, appStoreUrl: '' } });
    render(<UpdateAppBanner build={40} />);

    expect(screen.getByRole('status')).toHaveTextContent(/out of date/);
    expect(screen.getByRole('status')).toHaveTextContent(/Nothing you’ve logged is lost/);
    // No listing yet -> explain without a dead link.
    expect(screen.queryByRole('link', { name: 'Update' })).not.toBeInTheDocument();
  });

  it('links to the store once the server knows where the listing is', () => {
    useAuth.mockReturnValue({
      client: { minSupportedNativeBuild: 57, appStoreUrl: 'https://apps.apple.com/app/id1' },
    });
    render(<UpdateAppBanner build={40} />);

    expect(screen.getByRole('link', { name: 'Update' })).toHaveAttribute('href', 'https://apps.apple.com/app/id1');
  });

  it('renders nothing for a current build, on the web, or before /me has said anything', () => {
    useAuth.mockReturnValue({ client: { minSupportedNativeBuild: 57, appStoreUrl: '' } });
    const { container, rerender } = render(<UpdateAppBanner build={57} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<UpdateAppBanner build={null} />);
    expect(container).toBeEmptyDOMElement();

    useAuth.mockReturnValue({});
    rerender(<UpdateAppBanner build={40} />);
    expect(container).toBeEmptyDOMElement();
  });
});
