package com.worktrac.backend.admin;

import java.time.Instant;

public record AdminHealthDto(String status, Instant serverTime) {
}
