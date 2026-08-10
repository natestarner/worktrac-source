import { useState } from 'react';
import Modal from './Modal';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function NumericKeypad({ label, initialValue, onCancel, onDone }) {
  const [buffer, setBuffer] = useState(String(initialValue ?? ''));
  // The keypad opens showing the current value, but that value is unconfirmed until the first
  // keypress, which REPLACES it rather than appending to it. You tap 135 because you want to
  // type a different number -- appending made "tap 135, type 225" produce 135225, so every
  // exact entry started with backspacing the prefill out. Backspace while fresh clears it in
  // one press; after that, both keys behave normally.
  const [fresh, setFresh] = useState(true);

  function press(key) {
    setBuffer((buf) => {
      if (key === '⌫') return fresh ? '' : buf.slice(0, -1);
      if (key === '.') return fresh ? '0.' : buf.includes('.') ? buf : buf + '.';
      return fresh ? key : buf + key;
    });
    setFresh(false);
  }

  function done() {
    onDone(parseFloat(buffer) || 0);
  }

  return (
    <Modal width={420} align="bottom" onClose={onCancel}>
      <div
        style={{
          textAlign: 'center',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {/* role="status" so the running value announces as it's typed -- and so it can be
          addressed at all: its text is a bare number, which collides with the key buttons. */}
      <div role="status" style={{ textAlign: 'center', fontSize: 40, fontWeight: 800, marginBottom: 18 }}>
        {buffer || '0'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        {KEYS.map((k) => (
          <button
            key={k}
            onClick={() => press(k)}
            style={{
              padding: '18px 0',
              background: 'var(--color-subtle-bg)',
              border: 'none',
              borderRadius: 12,
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: 16,
            background: 'var(--color-subtle-bg)',
            color: 'var(--color-text)',
            border: 'none',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={done}
          style={{
            flex: 1,
            padding: 16,
            background: 'var(--color-dark)',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
