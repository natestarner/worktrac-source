import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChartHelp from './ChartHelp';

const help = {
  label: 'What the test chart shows',
  title: 'Test chart',
  lines: ['One dot per session.', 'Green means a PR.'],
};

describe('ChartHelp', () => {
  it('keeps the explanation out of the DOM until it is asked for', () => {
    // Not merely a rendering preference: four of these sit on the Trends screen at once, and
    // several existing e2e assertions match visible text by substring. Panels that were always
    // mounted (visually hidden) would collide with them.
    render(<ChartHelp help={help} />);
    expect(screen.queryByText('One dot per session.')).not.toBeInTheDocument();
  });

  it('opens on click and shows every line', () => {
    render(<ChartHelp help={help} />);
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));

    expect(screen.getByText('Test chart')).toBeInTheDocument();
    expect(screen.getByText('One dot per session.')).toBeInTheDocument();
    expect(screen.getByText('Green means a PR.')).toBeInTheDocument();
  });

  it('reports its open state to assistive tech', () => {
    render(<ChartHelp help={help} />);
    const trigger = screen.getByRole('button', { name: 'What the test chart shows' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes again on a second click of the trigger', () => {
    render(<ChartHelp help={help} />);
    const trigger = screen.getByRole('button', { name: 'What the test chart shows' });

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText('One dot per session.')).not.toBeInTheDocument();
  });

  it('closes on a click outside it', () => {
    render(
      <div>
        <ChartHelp help={help} />
        <button type="button">Somewhere else</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));
    // mousedown, not click: that is the event the outside-click listener binds, so a `click`
    // here would pass while the real interaction did nothing.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Somewhere else' }));

    expect(screen.queryByText('One dot per session.')).not.toBeInTheDocument();
  });

  it('leaves the panel open for a click inside it', () => {
    render(<ChartHelp help={help} />);
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));
    fireEvent.mouseDown(screen.getByText('One dot per session.'));

    expect(screen.getByText('One dot per session.')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<ChartHelp help={help} />);
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('One dot per session.')).not.toBeInTheDocument();
  });
});
