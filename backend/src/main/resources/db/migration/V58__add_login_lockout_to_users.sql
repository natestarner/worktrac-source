-- Temporary account lockout after repeated wrong passwords.
--
-- POST /api/auth/login had no throttle of any kind: no per-IP cap, no per-account cap, no lockout.
-- Passwords could be tried as fast as the network allowed, and each attempt costs a BCrypt
-- verification (~100ms of CPU), so the same endpoint was also a cheap way to saturate the
-- container's CPU. The per-IP limiter added alongside this bounds the DoS; this column pair is
-- what bounds guessing against one specific household, which a rotating source IP would otherwise
-- walk straight past.
--
-- Persisted rather than held in memory on purpose: an in-process counter resets on every restart
-- and every scale-out replica keeps its own, so an attacker gets a fresh allowance from whichever
-- instance answers. The database is the only place all replicas agree.
--
-- locked_until is a TIMESTAMP, not a flag, and that is the whole design. The lockout expires by
-- the clock with no admin action, no unlock endpoint to build and secure, and no support ticket --
-- a family member who fat-fingers their password is back in on their own. A successful password
-- reset clears both columns (PasswordResetService.confirmReset), so the instinctive "I must have
-- forgotten it" path unlocks them immediately rather than leaving them locked out holding a
-- password that now works.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'failed_login_attempts')
BEGIN
    ALTER TABLE users ADD failed_login_attempts INT NOT NULL
        CONSTRAINT DF_users_failed_login_attempts DEFAULT 0;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'locked_until')
BEGIN
    ALTER TABLE users ADD locked_until DATETIME2 NULL;
END
