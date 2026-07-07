package com.worktrac.backend.common;

// Thrown for both "doesn't exist" and "exists but belongs to another account" -- the
// caller should never be able to tell the two apart (a 403 on someone else's row would
// confirm it exists at all).
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }
}
