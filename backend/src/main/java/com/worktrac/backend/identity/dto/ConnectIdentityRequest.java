package com.worktrac.backend.identity.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** {@code POST /api/user/sign-in-methods/{provider}}: the same proof a sign-in carries. */
public record ConnectIdentityRequest(
        @NotBlank @Size(max = 8192, message = "must be 8192 characters or fewer") String idToken,
        @NotBlank @Size(min = 16, max = 256, message = "must be between 16 and 256 characters") String nonce) {
}
