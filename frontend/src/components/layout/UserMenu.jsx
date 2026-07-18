import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function UserMenu() {
  const { people, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const primaryName = people.find((p) => p.isPrimary)?.name || 'Account';

  // No existing dropdown/click-outside primitive in the codebase (Modal.jsx is a
  // full-screen scrim, not an anchored menu) -- close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  function handleLogout() {
    setOpen(false);
    logout();
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          color: 'var(--color-muted)',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 8,
        }}
      >
        {primaryName}
        <span style={{ fontSize: 10, transform: open ? 'rotate(180deg)' : 'none' }}>&#9662;</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
            minWidth: 180,
            overflow: 'hidden',
            zIndex: 10,
          }}
        >
          <MenuItem label="Profile" onClick={() => go('/app/profile')} />
          <MenuItem label="App Settings" onClick={() => go('/app/settings')} />
          {isAdmin && (
            <>
              <div style={{ borderTop: '1px solid var(--color-border)' }} />
              <MenuItem label="Admin Portal" onClick={() => go('/admin')} />
            </>
          )}
          <div style={{ borderTop: '1px solid var(--color-border)' }} />
          <MenuItem label="Logout" onClick={handleLogout} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: 'none',
        padding: '12px 16px',
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--color-text)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
