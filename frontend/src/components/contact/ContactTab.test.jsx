import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContactTab from './ContactTab';
import { sendContactMessage } from '../../api/contact';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { recordClientError } from '../../lib/lastClientError';
import { queryClient } from '../../lib/queryClient';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/app/contact', state: { from: '/app/log' } }),
}));
vi.mock('../../api/contact', () => ({ sendContactMessage: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

// useOutboxCount reads the app's singleton client (it is one of the diagnostics), so the page
// needs a provider around it -- the same client the real app uses, not a throwaway.
function render(ui) {
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// A tiny stand-in for the real per-person slice: the draft has to round-trip through context, not
// component state, or the "survives leaving the page" guarantee isn't what's being tested.
function mockAppState(initialDraft = null) {
  let draft = initialDraft;
  const setContactDraft = vi.fn((next) => {
    draft = next;
  });
  const clearContactDraft = vi.fn(() => {
    draft = null;
  });
  useAppState.mockImplementation(() => ({
    activePersonId: 7,
    contactDraft: draft,
    setContactDraft,
    clearContactDraft,
  }));
  return { setContactDraft, clearContactDraft, currentDraft: () => draft };
}

// The draft lives in context, so a change only reaches the next render via the mocked slice --
// two changes in a row without a rerender between them would each patch the SAME stale snapshot
// and the first would be lost. That is an artifact of mocking the context, not app behaviour.
function type(rerender, label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  rerender(<QueryClientProvider client={queryClient}><ContactTab /></QueryClientProvider>);
}

describe('ContactTab', () => {
  let showToast;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    onlineManager.setOnline(true);
    showToast = vi.fn();
    useUI.mockReturnValue({ showToast, openConfirm: vi.fn() });
    sendContactMessage.mockResolvedValue(undefined);
  });

  afterEach(() => onlineManager.setOnline(true));

  it('validates both fields before sending anything', async () => {
    mockAppState();
    render(<ContactTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Add a short subject.')).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
    expect(sendContactMessage).not.toHaveBeenCalled();
  });

  it('sends the message with its diagnostics and shows the sent panel', async () => {
    mockAppState();
    const { rerender } = render(<ContactTab />);
    type(rerender, 'Subject', 'Rest timer resets');
    type(rerender, 'Details', 'It resets whenever I switch tabs mid-set.');

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(sendContactMessage).toHaveBeenCalledTimes(1));
    const payload = sendContactMessage.mock.calls[0][0];
    expect(payload.category).toBe('SUGGESTION');
    expect(payload.subject).toBe('Rest timer resets');
    expect(payload.personId).toBe(7);
    // The screen they came FROM, not the contact page itself -- that is the useful half.
    expect(payload.diagnostics.screen).toBe('/app/log');
    expect(payload.diagnostics.wasOnline).toBe(true);

    expect(await screen.findByText('Message sent')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalled();
  });

  it('attaches the last render error the app hit', async () => {
    recordClientError(new Error('Cannot read properties of undefined'), { componentStack: 'at TrendsTab' });
    mockAppState({ category: 'BUG', subject: 'Trends blanks', message: 'Hovering the chart blanks it.' });
    render(<ContactTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(sendContactMessage).toHaveBeenCalled());
    expect(sendContactMessage.mock.calls[0][0].diagnostics.clientError).toContain(
      'Cannot read properties of undefined',
    );
  });

  it('lists what gets sent, so the diagnostics are not attached silently', async () => {
    mockAppState();
    render(<ContactTab />);

    fireEvent.click(screen.getByRole('button', { name: /What gets sent with this/ }));

    expect(await screen.findByText('Screen you came from')).toBeInTheDocument();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Changes waiting to sync')).toBeInTheDocument();
  });

  it('restores a draft written before the page was left', () => {
    mockAppState({ category: 'BUG', subject: 'Saved subject', message: 'Saved message body here.' });
    render(<ContactTab />);

    expect(screen.getByLabelText('Subject')).toHaveValue('Saved subject');
    expect(screen.getByLabelText('Details')).toHaveValue('Saved message body here.');
    expect(screen.getByRole('button', { name: 'Bug' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears the draft only after a send actually succeeds', async () => {
    const { clearContactDraft } = mockAppState({
      category: 'OTHER',
      subject: 'Subject',
      message: 'A long enough message body.',
    });
    render(<ContactTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(clearContactDraft).toHaveBeenCalled());
  });

  // The half that matters most: a gated write has no outbox behind it, so if a failure also wiped
  // what they typed, the message would be silently lost -- exactly what the degraded-conditions
  // contract forbids.
  it('keeps the draft when the send fails', async () => {
    sendContactMessage.mockRejectedValue(new Error('500'));
    const { clearContactDraft, currentDraft } = mockAppState({
      category: 'BUG',
      subject: 'Subject',
      message: 'A long enough message body.',
    });
    render(<ContactTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(sendContactMessage).toHaveBeenCalled());
    expect(clearContactDraft).not.toHaveBeenCalled();
    expect(currentDraft().message).toBe('A long enough message body.');
    expect(screen.queryByText('Message sent')).not.toBeInTheDocument();
  });

  // Tier-3: OfflineDisabledWrap greys the control out up front rather than letting someone type a
  // whole report and only then discover it can't go.
  it('disables sending while offline, with a reason', () => {
    onlineManager.setOnline(false);
    mockAppState();
    render(<ContactTab />);

    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', expect.stringMatching(/needs a connection/i));
  });
});
