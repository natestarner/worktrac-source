package com.worktrac.backend.identity;

import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.ServiceUnavailableException;
import com.worktrac.backend.identity.dto.Reconfirmation;
import com.worktrac.backend.user.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * "Prove it's you" with Apple or Google, and the Apple revocation that must precede deleting an
 * account with Apple connected. The token checks themselves are {@link IdTokenVerifierTest}'s; the
 * end-to-end flows are {@code ReconfirmationFlowTest}'s.
 */
@DisplayName("re-confirming with Apple or Google")
class ReconfirmationServiceTest {

    private final IdTokenVerifier verifier = mock(IdTokenVerifier.class);
    private final UserIdentityRepository identities = mock(UserIdentityRepository.class);
    private final AppleTokenRevoker revoker = mock(AppleTokenRevoker.class);
    private final ReconfirmationService service = new ReconfirmationService(verifier, identities, revoker);

    private User user;
    private User someoneElse;

    @BeforeEach
    void setUp() {
        user = new User("me@example.com", null);
        ReflectionTestUtils.setField(user, "id", 1L);
        someoneElse = new User("them@example.com", null);
        ReflectionTestUtils.setField(someoneElse, "id", 2L);
        when(verifier.isConfigured(any())).thenReturn(true);
    }

    private static Reconfirmation proof(String provider, String code) {
        return new Reconfirmation(provider, "id-token", "a-raw-nonce-of-plenty-length", code, null);
    }

    private static VerifiedIdentity verified(IdentityProvider provider, String subject) {
        return new VerifiedIdentity(provider, subject, "x@example.com", true, false, "com.huddle.app");
    }

    private void linked(IdentityProvider provider, String subject, User owner) {
        when(identities.findByProviderAndSubject(provider, subject))
                .thenReturn(Optional.of(new UserIdentity(owner, provider, subject, null, Instant.EPOCH)));
    }

    @Test
    void anIdentityLinkedToThisLoginIsProof() {
        when(verifier.verifyForReconfirmation(IdentityProvider.GOOGLE, "id-token", "a-raw-nonce-of-plenty-length"))
                .thenReturn(verified(IdentityProvider.GOOGLE, "g-1"));
        linked(IdentityProvider.GOOGLE, "g-1", user);

        assertThat(service.require(user, proof("google", null)).subject()).isEqualTo("g-1");
    }

    // ⚠️ The other parent on the family iPad signing in with THEIR Google account proves nothing
    // about this login.
    @Test
    void aValidSignInLinkedToSomebodyElseIsNotProof() {
        when(verifier.verifyForReconfirmation(any(), any(), any())).thenReturn(verified(IdentityProvider.GOOGLE, "g-2"));
        linked(IdentityProvider.GOOGLE, "g-2", someoneElse);

        assertThatThrownBy(() -> service.require(user, proof("google", null))).isInstanceOf(ForbiddenException.class);
    }

    @Test
    void aValidSignInLinkedToNobodyIsNotProof() {
        when(verifier.verifyForReconfirmation(any(), any(), any())).thenReturn(verified(IdentityProvider.GOOGLE, "g-3"));
        when(identities.findByProviderAndSubject(any(), any())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.require(user, proof("google", null))).isInstanceOf(ForbiddenException.class);
    }

    @Test
    void aBadTokenIsA403NeverA401() {
        when(verifier.verifyForReconfirmation(any(), any(), any())).thenThrow(new InvalidIdTokenException("nope"));
        assertThatThrownBy(() -> service.require(user, proof("google", null))).isInstanceOf(ForbiddenException.class);
    }

    @Test
    void anUnreachableProviderIsA503() {
        when(verifier.verifyForReconfirmation(any(), any(), any()))
                .thenThrow(new ProviderUnreachableException("down", null));
        assertThatThrownBy(() -> service.require(user, proof("google", null)))
                .isInstanceOf(ServiceUnavailableException.class);
    }

    @Test
    void noProofOrAnUnknownProviderIsRefused() {
        assertThatThrownBy(() -> service.require(user, null)).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.require(user, new Reconfirmation("google", " ", "n", null, null)))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.require(user, proof("facebook", null))).isInstanceOf(ForbiddenException.class);
    }

    // ── revoking Apple before deletion ─────────────────────────────────────────────────────────

    @Test
    void aLoginWithoutAppleNeedsNoRevocation() {
        when(identities.findByUser_IdAndProvider(1L, IdentityProvider.APPLE)).thenReturn(Optional.empty());
        service.revokeAppleIfLinked(user, proof(null, null), null);
        verify(revoker, never()).revoke(any(), any(), any(), any());
    }

    @Test
    void whereRevocationIsNotConfiguredDeletionIsNotBlocked() {
        appleLinked();
        when(revoker.isConfigured()).thenReturn(false);
        service.revokeAppleIfLinked(user, proof(null, null), null);
        verify(revoker, never()).revoke(any(), any(), any(), any());
    }

    // A password (or Google) re-confirmation cannot produce Apple's code, so it is refused with the
    // code that makes the client open Apple's sheet.
    @Test
    void appleConnectedButConfirmedAnotherWayIsAskedToConfirmWithApple() {
        appleLinked();
        when(revoker.isConfigured()).thenReturn(true);

        assertThatThrownBy(() -> service.revokeAppleIfLinked(user, proof(null, null), null))
                .isInstanceOf(ForbiddenException.class)
                .extracting(e -> ((ForbiddenException) e).getCode())
                .isEqualTo(ReconfirmationService.APPLE_RECONFIRMATION_REQUIRED);
        assertThatThrownBy(() -> service.revokeAppleIfLinked(user, proof("google", null),
                verified(IdentityProvider.GOOGLE, "g-1")))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.revokeAppleIfLinked(user, proof("apple", null),
                verified(IdentityProvider.APPLE, "a-1")))
                .isInstanceOf(ForbiddenException.class);
        verify(revoker, never()).revoke(any(), any(), any(), any());
    }

    @Test
    void anAppleConfirmationWithItsCodeRevokesAsTheSameClientForTheLinkedSubject() {
        appleLinked();
        when(revoker.isConfigured()).thenReturn(true);

        service.revokeAppleIfLinked(user, proof("apple", "code-1"), verified(IdentityProvider.APPLE, "a-1"));

        verify(revoker).revoke("com.huddle.app", "code-1", "a-1", null);
    }

    // Nothing is deleted when Apple cannot be told: we keep no Apple token, so there would be no
    // second chance to revoke later.
    @Test
    void aFailedRevocationIsA503SoNothingIsDeleted() {
        appleLinked();
        when(revoker.isConfigured()).thenReturn(true);
        doThrow(new AppleTokenRevoker.AppleRevocationException("down")).when(revoker).revoke(any(), any(), any(), any());

        assertThatThrownBy(() -> service.revokeAppleIfLinked(user, proof("apple", "code-1"),
                verified(IdentityProvider.APPLE, "a-1")))
                .isInstanceOf(ServiceUnavailableException.class);
    }

    private void appleLinked() {
        when(identities.findByUser_IdAndProvider(1L, IdentityProvider.APPLE))
                .thenReturn(Optional.of(new UserIdentity(user, IdentityProvider.APPLE, "a-1", null, Instant.EPOCH)));
    }
}
