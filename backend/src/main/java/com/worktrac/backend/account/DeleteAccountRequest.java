package com.worktrac.backend.account;

import com.worktrac.backend.identity.dto.Reconfirmation;
import jakarta.validation.Valid;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

// Typing DELETE proves intent; the password proves identity. Both are required, because this is
// the most destructive and least reversible action in the product -- it erases every household
// member's entire history, with no undo, no soft delete and no restore path in the app.
//
// Before the password field, the whole thing was authorised by a bearer token with a 30-day expiry
// and no revocation. A borrowed or stolen one -- a family tablet left signed in, a copied
// localStorage value -- was enough to wipe the household permanently.
public record DeleteAccountRequest(
        @NotBlank
        @Pattern(regexp = "DELETE", message = "you must type DELETE to confirm")
        String confirmationText,

        // Optional since sign in with Apple / Google: a login with no password proves itself with
        // `reconfirmation` instead. A password login that sends neither still gets a 400
        // (AccountDeletionService). Relaxing a required field is additive (api-compatibility.md).
        String password,

        @Valid
        Reconfirmation reconfirmation) {
}
