package com.worktrac.backend.common;

import java.time.Instant;

public record ApiError(Instant timestamp, int status, String message) {

    public static ApiError of(int status, String message) {
        return new ApiError(Instant.now(), status, message);
    }
}
