import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RefreshingPill from './RefreshingPill';

describe('RefreshingPill', () => {
  it('renders nothing when there is no background refresh', () => {
    const { container } = render(<RefreshingPill show={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces a background refresh so an on-screen value never changes unannounced', () => {
    render(<RefreshingPill show />);
    expect(screen.getByText('Refreshing…')).toBeInTheDocument();
  });
});
