import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CriticalErrorFallback from './CriticalErrorFallback';

describe('CriticalErrorFallback', () => {
  it('renders the given title and the queued-work reassurance', () => {
    render(<CriticalErrorFallback title="Huddle ran into a problem" retry={vi.fn()} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Huddle ran into a problem')).toBeInTheDocument();
    expect(screen.getByText(/still saved on this device/i)).toBeInTheDocument();
  });

  it('a real link to /login, not a client-side navigation', () => {
    render(<CriticalErrorFallback title="Huddle ran into a problem" retry={vi.fn()} />);

    const login = screen.getByRole('link', { name: 'Go to login' });
    expect(login.tagName).toBe('A');
    expect(login).toHaveAttribute('href', '/login');
  });

  it('Try again calls the supplied retry callback', () => {
    const retry = vi.fn();
    render(<CriticalErrorFallback title="Huddle ran into a problem" retry={retry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
