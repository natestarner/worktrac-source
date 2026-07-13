package com.worktrac.backend.common;

public class LockedException extends RuntimeException {

    public LockedException(String message) {
        super(message);
    }
}
