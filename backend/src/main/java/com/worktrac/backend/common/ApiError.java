package com.worktrac.backend.common;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * The error body every failure answers with.
 *
 * <p>{@code code} is optional and omitted from the JSON when null, so every existing response is
 * byte-for-byte what it was. It exists for the ONE case where the client must distinguish two
 * failures that share a status and would otherwise be indistinguishable: a 403 from a paused
 * member login is recoverable (the household re-upgrades and the queued write lands), whereas
 * every other 403 is not. {@code isDeadWrite} reads it.
 *
 * <p>⚠️ Resist adding codes for refusals the client only ever shows to a person. A message is
 * for a human and can be reworded freely; a code is a contract both sides must keep in step. This
 * one earns it because a machine acts on it — see {@code MEMBER_LOGIN_PAUSED}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(Instant timestamp, int status, String message, String code) {

    public static ApiError of(int status, String message) {
        return new ApiError(Instant.now(), status, message, null);
    }

    public static ApiError of(int status, String message, String code) {
        return new ApiError(Instant.now(), status, message, code);
    }
}
