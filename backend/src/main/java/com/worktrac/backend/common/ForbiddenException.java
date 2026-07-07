package com.worktrac.backend.common;

// For cases where the row's existence is already known/visible (e.g. a global exercise
// every account can see) but the caller isn't allowed to mutate it.
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }
}
