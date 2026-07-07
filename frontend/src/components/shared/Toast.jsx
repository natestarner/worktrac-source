import { useUI } from '../../context/UIContext';

export default function Toast() {
  const { toast } = useUI();
  if (!toast) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 32,
        left: '50%',
        background: 'var(--color-success)',
        color: '#fff',
        padding: '14px 24px',
        borderRadius: 999,
        fontSize: 15,
        fontWeight: 700,
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        zIndex: 40,
        animation: 'toastIn .25s ease',
        transform: 'translateX(-50%)',
      }}
    >
      {toast}
    </div>
  );
}
