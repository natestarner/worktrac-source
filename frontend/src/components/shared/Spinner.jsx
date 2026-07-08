export default function Spinner({ size = 18, color = 'currentColor' }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `2px solid ${color}`,
        borderTopColor: 'transparent',
        borderRadius: '50%',
        opacity: 0.85,
        animation: 'spin 0.7s linear infinite',
      }}
    />
  );
}
