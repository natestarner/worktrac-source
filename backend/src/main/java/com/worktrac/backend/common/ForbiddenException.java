package com.worktrac.backend.common;

// For cases where the row's existence is already known/visible (e.g. a global exercise
// every account can see) but the caller isn't allowed to mutate it.
public class ForbiddenException extends RuntimeException {

    private final String code;

    public ForbiddenException(String message) {
        this(message, null);
    }

    /**
     * A refusal the CLIENT has to act on rather than merely display.
     *
     * <p>The only one today is {@code MEMBER_LOGIN_PAUSED}, and the reason it needs a code is the
     * durable outbox: a 403 is normally a definitive refusal, so {@code isDeadWrite} reports the
     * write as one that can never land. A paused login's 403 is the opposite — the household
     * re-upgrades and the queued work lands by itself. Without something machine-readable the
     * client would tell a member their sets are lost when they are not.
     */
    public ForbiddenException(String message, String code) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
