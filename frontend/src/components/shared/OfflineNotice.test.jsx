import { onlineManager } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import OfflineNotice from './OfflineNotice';

describe('OfflineNotice', () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => onlineManager.setOnline(true));

  it('renders nothing while online', () => {
    const { container } = render(<OfflineNotice message="Editing needs a connection." />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the message while offline', () => {
    onlineManager.setOnline(false);
    render(<OfflineNotice message="Editing needs a connection." />);
    expect(screen.getByText('Editing needs a connection.')).toBeInTheDocument();
  });

  it('falls back to a generic message when none is given', () => {
    onlineManager.setOnline(false);
    render(<OfflineNotice />);
    expect(screen.getByText('This needs a connection.')).toBeInTheDocument();
  });
});
