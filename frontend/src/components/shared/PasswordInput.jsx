import { useState } from 'react';
import IconButton from './IconButton';
import { IconEye, IconEyeOff } from './icons';

// Room on the right for the 40px eye, so typed text never runs under it.
const TOGGLE_ROOM = 'calc(40px + var(--space-2))';

/**
 * A password field with a show / hide eye -- every password field in the app goes through this.
 *
 * Same props as `Input` (`id`, `invalid`, `error`, `className`, `style`, and anything an <input>
 * takes); `type` is the component's own. A plain `<input className="input">` caller passes its
 * className through unchanged. What it owes a phone:
 *
 *   - Tapping the eye keeps focus in the field (`onMouseDown` preventDefault), so iOS does not
 *     close the keyboard halfway through typing a password.
 *   - Shown as text, iOS would auto-capitalise and autocorrect it. `autoCapitalize`, `autoCorrect`
 *     and `spellCheck` are off in both states, so revealing it never changes what gets typed.
 *   - The field keeps its `id`, `name` and `autoComplete`, so labels, Password AutoFill and the
 *     e2e suite's selectors find it exactly as before. The eye's name is "Show password" / "Hide
 *     password", which contains none of the field labels the tests look up ("Current password",
 *     "New password", "Confirm new password").
 *
 * Each field has its own eye and starts hidden.
 */
export default function PasswordInput({ id, invalid = false, error, className = 'input', style, ...rest }) {
  const [shown, setShown] = useState(false);
  const errorId = error && id ? `${id}-error` : undefined;
  // A caller's margins belong on the wrapper: on the field they would make the wrapper taller than
  // the field, and the eye (centred on the wrapper) would sit off-centre. authStyles' inputStyle
  // carries a marginBottom, for one.
  const outer = {};
  const inner = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    (key.startsWith('margin') ? outer : inner)[key] = value;
  }
  return (
    <>
      <div className="password-field" style={outer}>
        <input
          id={id}
          className={[className, (invalid || error) && 'input-invalid'].filter(Boolean).join(' ')}
          aria-invalid={invalid || !!error || undefined}
          aria-describedby={errorId}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...rest}
          style={{ ...inner, paddingRight: TOGGLE_ROOM }}
          type={shown ? 'text' : 'password'}
        />
        <IconButton
          icon={shown ? IconEyeOff : IconEye}
          label={shown ? 'Hide password' : 'Show password'}
          className="password-toggle"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShown((s) => !s)}
        />
      </div>
      {error && (
        <div id={errorId} className="field-error">
          {error}
        </div>
      )}
    </>
  );
}
