import { render, screen, fireEvent } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

// React logs caught render errors to console.error regardless of the boundary; silence it so a
// deliberate throw doesn't look like a failing test.
let consoleError;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

function Boom({ shouldThrow }) {
  if (shouldThrow) throw new Error('render exploded');
  return <div>working content</div>;
}

describe('ErrorBoundary', () => {
  it('shows a fallback instead of unmounting the tree when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The reassurance matters as much as the error: queued writes live in IndexedDB, not in the
    // component that just crashed, so nothing the person logged is actually lost.
    expect(screen.getByText(/still saved on this device/i)).toBeInTheDocument();
  });

  it('recovers in place when the person taps Try again', () => {
    function Harness() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button onClick={() => setBroken(false)}>fix it</button>
          <ErrorBoundary>
            <Boom shouldThrow={broken} />
          </ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByText('fix it'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('working content')).toBeInTheDocument();
  });

  it('clears a previous screen error when resetKey changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/app/trends">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/app/log">
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('working content')).toBeInTheDocument();
  });

  // THE REGRESSION TEST. The first version of this component was mounted as
  // `<ErrorBoundary key={location.pathname}>`, which force-remounts the whole tab panel on EVERY
  // navigation rather than only after an error. That churned the app chrome hard enough that the
  // header menu detached mid-click and multi-person.spec.ts went red -- a boundary added for
  // resilience was destabilising ordinary navigation. resetKey must reset state WITHOUT
  // remounting children.
  it('does not remount its children when resetKey changes', () => {
    const mounted = vi.fn();
    function CountsMounts() {
      useEffect(() => {
        mounted();
      }, []);
      return <div>stable child</div>;
    }

    const { rerender } = render(
      <ErrorBoundary resetKey="/app/log">
        <CountsMounts />
      </ErrorBoundary>,
    );
    expect(mounted).toHaveBeenCalledTimes(1);

    rerender(
      <ErrorBoundary resetKey="/app/history">
        <CountsMounts />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey="/app/trends">
        <CountsMounts />
      </ErrorBoundary>,
    );

    expect(mounted).toHaveBeenCalledTimes(1);
  });
});
