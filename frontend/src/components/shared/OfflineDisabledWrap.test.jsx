import { onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineDisabledWrap from './OfflineDisabledWrap';

describe('OfflineDisabledWrap', () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => onlineManager.setOnline(true));

  it('passes the child through unchanged while online', () => {
    const onClick = vi.fn();
    render(
      <OfflineDisabledWrap message="Nope">
        <button onClick={onClick}>Add person</button>
      </OfflineDisabledWrap>,
    );

    const button = screen.getByRole('button', { name: 'Add person' });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('title');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it('disables the child and adds a title while offline', () => {
    onlineManager.setOnline(false);
    const onClick = vi.fn();
    render(
      <OfflineDisabledWrap message="Adding a person needs a connection.">
        <button onClick={onClick}>Add person</button>
      </OfflineDisabledWrap>,
    );

    const button = screen.getByRole('button', { name: 'Add person' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Adding a person needs a connection.');
  });

  it('preserves the child\'s existing inline style while merging in the disabled look', () => {
    onlineManager.setOnline(false);
    render(
      <OfflineDisabledWrap>
        <button style={{ flex: 1, color: 'rgb(255, 0, 0)' }}>Export</button>
      </OfflineDisabledWrap>,
    );

    const button = screen.getByRole('button', { name: 'Export' });
    expect(button).toHaveStyle({ flex: '1', color: 'rgb(255, 0, 0)', opacity: '0.5', cursor: 'not-allowed' });
  });

  it('does not disable when `when` is false, even while offline', () => {
    onlineManager.setOnline(false);
    render(
      <OfflineDisabledWrap when={false}>
        <button>Remove</button>
      </OfflineDisabledWrap>,
    );

    expect(screen.getByRole('button', { name: 'Remove' })).not.toBeDisabled();
  });
});
