import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminActivity from './AdminActivity';
import {
  listRegistrationEvents,
  getRegistrationAlertSettings,
  updateRegistrationAlertSettings,
  previewTestData,
  deleteTestData,
} from '../../api/admin';
import { useUI } from '../../context/UIContext';

vi.mock('../../api/admin', () => ({
  listRegistrationEvents: vi.fn(),
  getRegistrationAlertSettings: vi.fn(),
  updateRegistrationAlertSettings: vi.fn(),
  previewTestData: vi.fn(),
  deleteTestData: vi.fn(),
}));

vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

const SAMPLE_EVENTS = [
  {
    id: 1,
    email: 'jo@example.com',
    eventType: 'REGISTER_STARTED',
    detail: null,
    ipAddress: '1.2.3.4',
    messageId: null,
    createdAt: '2026-08-03T10:00:00Z',
  },
  {
    id: 2,
    email: 'jo@example.com',
    eventType: 'VERIFICATION_EMAIL_FAILED',
    detail: 'ACS send did not succeed: status=FAILED code=SenderNotVerified',
    ipAddress: null,
    messageId: null,
    createdAt: '2026-08-03T10:00:05Z',
  },
];

const DEFAULT_SETTINGS = {
  alertOnRegistrationConfirmed: false,
  alertOnSendFailure: true,
  alertOnDeliveryFailure: true,
};

describe('AdminActivity', () => {
  let openConfirm;
  let showToast;

  beforeEach(() => {
    vi.clearAllMocks();
    listRegistrationEvents.mockResolvedValue(SAMPLE_EVENTS);
    getRegistrationAlertSettings.mockResolvedValue(DEFAULT_SETTINGS);
    updateRegistrationAlertSettings.mockResolvedValue(DEFAULT_SETTINGS);
    openConfirm = vi.fn();
    showToast = vi.fn();
    useUI.mockReturnValue({ openConfirm, showToast });
  });

  it('renders the event feed once loaded', async () => {
    render(<AdminActivity />);

    expect(await screen.findByText('REGISTER_STARTED')).toBeInTheDocument();
    expect(screen.getAllByText('jo@example.com')).toHaveLength(2);
    expect(screen.getByText('VERIFICATION_EMAIL_FAILED')).toBeInTheDocument();
    expect(screen.getByText(/SenderNotVerified/)).toBeInTheDocument();
  });

  it('shows an empty message when there is no activity', async () => {
    listRegistrationEvents.mockResolvedValue([]);
    render(<AdminActivity />);

    expect(await screen.findByText('No registration activity yet.')).toBeInTheDocument();
  });

  it('"Only show issues" hides positive events like REGISTER_STARTED', async () => {
    render(<AdminActivity />);
    await screen.findByText('REGISTER_STARTED');

    fireEvent.click(screen.getByLabelText('Only show issues'));

    expect(screen.queryByText('REGISTER_STARTED')).not.toBeInTheDocument();
    expect(screen.getByText('VERIFICATION_EMAIL_FAILED')).toBeInTheDocument();
  });

  it('renders a legend explaining event colors and the sent-vs-delivered distinction', async () => {
    render(<AdminActivity />);
    await screen.findByText('REGISTER_STARTED');

    expect(screen.getByText('Legend')).toBeInTheDocument();
    expect(screen.getByText(/not proof the email reached anyone/i)).toBeInTheDocument();
  });

  it('gives the Detail cell a title attribute with the full untruncated text', async () => {
    const longDetail =
      'ACS send did not succeed: status=FAILED code=SenderNotVerified message=The sender domain has not completed verification and cannot be used to send email until DNS records are confirmed';
    listRegistrationEvents.mockResolvedValue([{ ...SAMPLE_EVENTS[1], detail: longDetail }]);
    render(<AdminActivity />);

    const cell = await screen.findByTitle(longDetail);
    expect(cell).toHaveTextContent(longDetail);
  });

  it('toggling an alert-settings checkbox saves and refetches the settings', async () => {
    render(<AdminActivity />);

    const sendFailureCheckbox = await screen.findByLabelText('A verification or success email fails to send');
    expect(sendFailureCheckbox).toBeChecked();

    updateRegistrationAlertSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, alertOnSendFailure: false });
    getRegistrationAlertSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, alertOnSendFailure: false });

    fireEvent.click(sendFailureCheckbox);

    await waitFor(() =>
      expect(updateRegistrationAlertSettings).toHaveBeenCalledWith({
        ...DEFAULT_SETTINGS,
        alertOnSendFailure: false,
      }),
    );
    await waitFor(() => expect(getRegistrationAlertSettings).toHaveBeenCalledTimes(2));
  });

  it('previews counts and opens the confirm dialog before deleting test data', async () => {
    previewTestData.mockResolvedValue({ accountCount: 3, registrationEventCount: 42, pendingRegistrationCount: 1 });
    render(<AdminActivity />);
    await screen.findByText('REGISTER_STARTED');

    fireEvent.click(screen.getByRole('button', { name: 'Delete all e2e test data' }));

    await waitFor(() => expect(previewTestData).toHaveBeenCalled());
    expect(openConfirm).toHaveBeenCalledWith(
      expect.stringContaining('3 test account(s), 42 activity event(s), and 1 pending registration(s)'),
      expect.any(Function),
    );
    // Nothing deleted yet -- only confirming actually calls the delete endpoint.
    expect(deleteTestData).not.toHaveBeenCalled();
  });

  it('deletes test data, shows a toast, and refetches the feed once the dialog is confirmed', async () => {
    previewTestData.mockResolvedValue({ accountCount: 1, registrationEventCount: 2, pendingRegistrationCount: 0 });
    deleteTestData.mockResolvedValue({ accountCount: 1, registrationEventCount: 2, pendingRegistrationCount: 0 });
    render(<AdminActivity />);
    await screen.findByText('REGISTER_STARTED');

    fireEvent.click(screen.getByRole('button', { name: 'Delete all e2e test data' }));
    await waitFor(() => expect(openConfirm).toHaveBeenCalled());

    // Simulate the shared ConfirmDialog's "Delete" button invoking the callback it was given.
    const confirmCallback = openConfirm.mock.calls[0][1];
    listRegistrationEvents.mockResolvedValue([]);
    await act(async () => {
      await confirmCallback();
    });

    expect(deleteTestData).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Deleted all e2e test data.');
    await waitFor(() => expect(listRegistrationEvents).toHaveBeenCalledTimes(2));
  });
});
