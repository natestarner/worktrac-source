import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChartHelp from './ChartHelp';

const help = {
  label: 'What the test chart shows',
  title: 'Test chart',
  lines: ['One dot per session.', 'Green means a PR.'],
};

function renderHelp(props = { help }) {
  return render(
    <MemoryRouter>
      <ChartHelp {...props} />
    </MemoryRouter>,
  );
}

// jsdom has no matchMedia; useMediaQuery reads it, so each test that cares says how wide the
// screen is. Unset, the hook reports "not compact".
function setCompact(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

afterEach(() => {
  delete window.matchMedia;
});

describe('ChartHelp', () => {
  it('keeps the explanation out of the DOM until it is asked for', () => {
    // Not merely a rendering preference: four of these sit on the Trends screen at once, and
    // several existing e2e assertions match visible text by substring. A dialog that was always
    // mounted (visually hidden) would collide with them.
    renderHelp();
    expect(screen.queryByText('One dot per session.')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a dialog titled for the chart, with every line', () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));

    const dialog = screen.getByRole('dialog', { name: 'Test chart' });
    expect(within(dialog).getByText('One dot per session.')).toBeInTheDocument();
    expect(within(dialog).getByText('Green means a PR.')).toBeInTheDocument();
  });

  it('reports that it opens a dialog, and whether it is open, to assistive tech', () => {
    renderHelp();
    const trigger = screen.getByRole('button', { name: 'What the test chart shows' });

    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes from its X', () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // Modal's rule for every dialog (frontend-core.md): the backdrop is inert. The help sheet follows
  // it rather than being the one dialog that a stray tap dismisses.
  it('does not close when the backdrop is tapped', () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));
    const scrim = screen.getByRole('dialog').parentElement;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('rises as a bottom sheet on a phone-width screen', () => {
    setCompact(true);
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));

    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ alignItems: 'flex-end' });
  });

  it('sits centred on a wider screen', () => {
    setCompact(false);
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));

    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ alignItems: 'center' });
  });

  it('offers a link to the rest of the explanation when there is more, and closes as it follows it', () => {
    renderHelp({ help: { ...help, more: { label: 'More in the Help page', to: '/app/help#history' } } });
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));
    const link = within(screen.getByRole('dialog')).getByRole('link', { name: 'More in the Help page' });

    expect(link).toHaveAttribute('href', '/app/help#history');
    fireEvent.click(link);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no link when there is nothing more to read', () => {
    renderHelp();
    fireEvent.click(screen.getByRole('button', { name: 'What the test chart shows' }));

    expect(within(screen.getByRole('dialog')).queryByRole('link')).not.toBeInTheDocument();
  });
});
