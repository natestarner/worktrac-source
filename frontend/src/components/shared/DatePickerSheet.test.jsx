import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DatePickerSheet from './DatePickerSheet';

// "Today" is pinned so the month on screen, the disabled future and the today marker are fixed.
// Only Date is faked -- React and RTL still need real timers.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 24, 10, 0)); // Thu Sep 24 2026, local
});
afterEach(() => {
  vi.useRealTimers();
});

function renderSheet(props = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <DatePickerSheet
      value={null}
      onChange={onChange}
      onClose={onClose}
      workoutCounts={new Map([['2026-09-12', 1], ['2026-09-20', 2]])}
      minDate="2026-07-01"
      maxDate="2026-09-24"
      {...props}
    />,
  );
  return { onChange, onClose };
}

const day = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('DatePickerSheet', () => {
  it('opens on the current month in a labelled dialog', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'Choose a date' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
  });

  it('marks the days that have workouts, in both the dot and the accessible name', () => {
    renderSheet();
    expect(day('Saturday, September 12, 2026, 1 workout')).toBeInTheDocument();
    expect(day('Sunday, September 20, 2026, 2 workouts')).toBeInTheDocument();
    expect(day('Saturday, September 12, 2026').querySelector('.date-cal-dot')).not.toBeNull();
    expect(day('Friday, September 11, 2026').querySelector('.date-cal-dot')).toBeNull();
    expect(screen.getByText('Workout logged')).toBeInTheDocument();
  });

  it('marks today, and disables days after the max', () => {
    renderSheet();
    const today = day('Thursday, September 24, 2026');
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveAccessibleName(/today$/);
    expect(day('Friday, September 25, 2026')).toBeDisabled();
    expect(day('Wednesday, September 23, 2026')).toBeEnabled();
  });

  it('commits a single day on the tap, and closes', () => {
    const { onChange, onClose } = renderSheet();
    fireEvent.click(day('Saturday, September 12, 2026'));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-09-12', to: '2026-09-12' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the committed value as selected, and opens on its month', () => {
    renderSheet({ value: { from: '2026-08-05', to: '2026-08-05' } });
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    expect(day('Wednesday, August 5, 2026')).toHaveAttribute('aria-pressed', 'true');
    expect(day('Thursday, August 6, 2026')).toHaveAttribute('aria-pressed', 'false');
  });

  it('lands focus on the selected day (WAI-ARIA date picker), with only that day in the Tab order', () => {
    renderSheet({ value: { from: '2026-09-12', to: '2026-09-12' } });
    const selected = day('Saturday, September 12, 2026');
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(day('Friday, September 11, 2026')).toHaveAttribute('tabindex', '-1');
  });

  it('lands focus on today when nothing is selected', () => {
    renderSheet();
    expect(day('Thursday, September 24, 2026')).toHaveFocus();
  });

  it('pages months with the chevrons, and stops at both bounds', () => {
    renderSheet();
    const next = screen.getByRole('button', { name: 'Next month' });
    const prev = screen.getByRole('button', { name: 'Previous month' });
    expect(next).toBeDisabled(); // September is the max month

    fireEvent.click(prev);
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    fireEvent.click(prev);
    expect(screen.getByRole('heading', { name: 'July 2026' })).toBeInTheDocument();
    expect(prev).toBeDisabled(); // July holds the earliest workout

    fireEvent.click(next);
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
  });

  it('moves focus with the keyboard, across months, and clamps at the max', () => {
    renderSheet({ value: { from: '2026-09-01', to: '2026-09-01' } });
    const grid = screen.getByRole('grid');

    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    expect(day('Monday, August 31, 2026')).toHaveFocus();

    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(day('Monday, September 7, 2026')).toHaveFocus();

    fireEvent.keyDown(grid, { key: 'Home' });
    expect(day('Sunday, September 6, 2026')).toHaveFocus();
    fireEvent.keyDown(grid, { key: 'End' });
    expect(day('Saturday, September 12, 2026')).toHaveFocus();

    fireEvent.keyDown(grid, { key: 'PageUp' });
    expect(day('Wednesday, August 12, 2026')).toHaveFocus();

    // Past the max: clamps to today rather than landing on a disabled day.
    fireEvent.keyDown(grid, { key: 'PageDown', shiftKey: true });
    expect(day('Thursday, September 24, 2026')).toHaveFocus();
  });

  it('pages months with a horizontal swipe, and ignores a vertical drag', () => {
    renderSheet();
    const grid = screen.getByRole('grid');
    fireEvent.touchStart(grid, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 220, clientY: 110 }] });
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();

    fireEvent.touchStart(grid, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 160, clientY: 300 }] });
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
  });

  it('offers Clear date only when a date is applied', () => {
    renderSheet();
    expect(screen.queryByRole('button', { name: 'Clear date' })).toBeNull();
  });

  it('Clear date removes the filter and closes', () => {
    const { onChange, onClose } = renderSheet({ value: { from: '2026-09-12', to: '2026-09-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });

  it('the X closes without changing anything', () => {
    const { onChange, onClose } = renderSheet({ value: { from: '2026-09-12', to: '2026-09-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  // Not offered in History yet. Pinned here so enabling it is a prop, not a rewrite.
  it('range mode: stays open after the first tap, and commits the ordered range on the second', () => {
    const { onChange, onClose } = renderSheet({ mode: 'range' });
    fireEvent.click(day('Sunday, September 20, 2026'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Now pick the last day.')).toBeInTheDocument();

    fireEvent.click(day('Saturday, September 12, 2026'));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-09-12', to: '2026-09-20' });
    expect(onClose).toHaveBeenCalled();
  });

  it('draws a committed range as a band from start to end', () => {
    renderSheet({ value: { from: '2026-09-10', to: '2026-09-12' } });
    const grid = screen.getByRole('grid');
    const cellOf = (name) => day(name).closest('td');
    expect(cellOf('Thursday, September 10, 2026')).toHaveAttribute('data-band', 'start');
    expect(cellOf('Friday, September 11, 2026')).toHaveAttribute('data-band', 'mid');
    expect(cellOf('Saturday, September 12, 2026')).toHaveAttribute('data-band', 'end');
    expect(within(grid).getAllByRole('gridcell', { selected: true })).toHaveLength(3);
  });
});
