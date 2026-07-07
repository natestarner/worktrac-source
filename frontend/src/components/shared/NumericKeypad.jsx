import { useState } from 'react';
import Modal from './Modal';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function NumericKeypad({ label, initialValue, onCancel, onDone }) {
  const [buffer, setBuffer] = useState(String(initialValue ?? ''));

  function press(key) {
    setBuffer((buf) => {
      if (key === '⌫') return buf.slice(0, -1);
      if (key === '.') return buf.includes('.') ? buf : buf + '.';
      return buf === '0' ? key : buf + key;
    });
  }

  function done() {
    onDone(parseFloat(buffer) || 0);
  }

  return (
    <Modal width={420} align="bottom">
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
      <div style={{ textAlign: 'center', fontSize: 40, fontWeight: 800, marginBottom: 18 }}>{buffer || '0'}</div>
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
