import { onlineManager } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import OfflineDataNotice from './OfflineDataNotice';

describe('OfflineDataNotice', () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => onlineManager.setOnline(true));

  it('renders nothing while online, even with a timestamp', () => {
    const { container } = render(<OfflineDataNotice updatedAt={Date.now()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while offline if there is no timestamp yet (never successfully fetched)', () => {
    onlineManager.setOnline(false);
    const { container } = render(<OfflineDataNotice updatedAt={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a formatted "as of" timestamp while offline', () => {
    onlineManager.setOnline(false);
    render(<OfflineDataNotice updatedAt={new Date('2026-07-22T15:14:00').getTime()} />);

    expect(screen.getByRole('status')).toHaveTextContent(/Offline.*data as of.*Jul 22, 2026/);
  });
});
