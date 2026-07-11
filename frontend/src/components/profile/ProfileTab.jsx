import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function ProfileTab() {
  const { user, account, people } = useAuth();
  const navigate = useNavigate();
  const primary = people.find((p) => p.isPrimary);

  return (
    <div>
      <button onClick={() => navigate(-1)} style={backButtonStyle}>
        &larr; Back
      </button>

      <div style={sectionLabelStyle}>Account holder</div>
      <div style={cardStyle}>
        <Field label="Name" value={primary?.name} />
        <Field label="Household" value={account?.name} />
        <Field label="Email" value={user?.email} last />
      </div>

      <div style={sectionLabelStyle}>People</div>
      <div style={cardStyle}>
        {people.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 0',
              borderBottom: i < people.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</div>
            {p.isPrimary && <span style={badgeStyle}>PRIMARY</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, last }) {
  return (
    <div style={{ padding: '14px 0', borderBottom: last ? 'none' : '1px solid var(--color-subtle-bg)' }}>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const backButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent)',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '0 0 16px 0',
};

const sectionLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 12,
};

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '4px 20px',
  marginBottom: 24,
};

const badgeStyle = {
  fontSize: 11,
  fontWeight: 800,
  color: 'var(--color-muted)',
  background: 'var(--color-subtle-bg)',
  padding: '3px 8px',
  borderRadius: 999,
};
