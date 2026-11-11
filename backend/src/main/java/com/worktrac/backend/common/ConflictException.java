package com.worktrac.backend.common;

public class ConflictException extends RuntimeException {

    private final String code;

    public ConflictException(String message) {
        this(message, null);
    }

    /**
     * A conflict the CLIENT acts on rather than only displays -- see {@link ApiError} for why codes
     * are rare. The one today is {@code SIGN_UP_REQUIRED}: an Apple or Google sign-in for somebody
     * with no Huddle login yet, which the client answers by asking for a name and trying again.
     */
    public ConflictException(String message, String code) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
