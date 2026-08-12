import { act, screen } from '@testing-library/react';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import { LOG_SET_MUTATION_KEY } from '../../lib/queryClient';
import OfflineDataNotice from './OfflineDataNotice';

vi.mock('../../api/sets', () => ({
  logLiveSet: vi.fn(),
  logSetIntoSession: vi.fn(),
  editSet: vi.fn(),
  deleteSet: vi.fn(),
}));

// Queues a real durable write rather than stubbing a count, so this exercises the same
// useOutboxCount predicate the banner does -- see OfflineBanner.test.jsx's identical helper.
function dispatchLogSet(client, idempotencyKey) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(LOG_SET_MUTATION_KEY),
    mutationKey: LOG_SET_MUTATION_KEY,
  });
  observer
    .mutate({
      mode: 'live', personId: 7, exerciseId: 1, weight: 135, reps: 5, unit: 'lb',
      idempotencyKey, clientLoggedAt: 't', tempId: `temp-${idempotencyKey}`,
    })
    .catch(() => {});
}

const AS_OF = new Date('2026-07-22T15:14:00').getTime();

describe('OfflineDataNotice', () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => onlineManager.setOnline(true));

  it('renders nothing while online, even with a timestamp', () => {
    const { container } = renderWithQuery(<OfflineDataNotice updatedAt={Date.now()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while offline if there is no timestamp yet (never successfully fetched)', () => {
    onlineManager.setOnline(false);
    const { container } = renderWithQuery(<OfflineDataNotice updatedAt={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a formatted "as of" timestamp while offline', () => {
    onlineManager.setOnline(false);
    renderWithQuery(<OfflineDataNotice updatedAt={AS_OF} />);

    expect(screen.getByRole('status')).toHaveTextContent(/Offline.*data as of.*Jul 22, 2026/);
  });

  it('says nothing about unsynced changes when the outbox is empty', () => {
    onlineManager.setOnline(false);
    renderWithQuery(<OfflineDataNotice updatedAt={AS_OF} />);

    expect(screen.getByRole('status')).not.toHaveTextContent(/synced/);
  });

  it('warns that the cached view is incomplete while a write is still queued', async () => {
    onlineManager.setOnline(false);
    const { queryClient } = renderWithQuery(<OfflineDataNotice updatedAt={AS_OF} />);

    act(() => dispatchLogSet(queryClient, 'a'));

    // hasn.t, not hasn't -- the copy uses a curly apostrophe, same as OfflineBanner's tests.
    expect(await screen.findByText(/1 change hasn.t synced yet, so this is incomplete/)).toBeInTheDocument();
    // The timestamp stays -- the warning is additive, not a replacement.
    expect(screen.getByRole('status')).toHaveTextContent(/data as of.*Jul 22, 2026/);
  });

  it('pluralizes the queued-change count', async () => {
    onlineManager.setOnline(false);
    const { queryClient } = renderWithQuery(<OfflineDataNotice updatedAt={AS_OF} />);

    act(() => {
      dispatchLogSet(queryClient, 'b');
      dispatchLogSet(queryClient, 'c');
      dispatchLogSet(queryClient, 'd');
    });

    expect(await screen.findByText(/3 changes haven.t synced yet, so this is incomplete/)).toBeInTheDocument();
  });
});
