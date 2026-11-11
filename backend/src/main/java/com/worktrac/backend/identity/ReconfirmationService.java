package com.worktrac.backend.identity;

import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.ServiceUnavailableException;
import com.worktrac.backend.identity.dto.Reconfirmation;
import com.worktrac.backend.user.User;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * "Prove it's you" with Apple or Google, for an action a session alone must not authorize.
 *
 * <p>The token must verify AND name an identity already linked to THIS login. A valid Google
 * sign-in by somebody else -- the other parent on the family iPad -- proves nothing about this
 * login, which is the whole reason the check exists.
 *
 * <p>Every refusal is a 403, never a 401: these run on a live session, and a 401 would sign the
 * person out over a second credential (backend-core.md).
 */
@Service
public class ReconfirmationService {

    private static final Logger log = LoggerFactory.getLogger(ReconfirmationService.class);

    /** The client re-opens the provider's sheet on this code (it asked for the wrong thing). */
    public static final String APPLE_RECONFIRMATION_REQUIRED = "APPLE_RECONFIRMATION_REQUIRED";

    private final IdTokenVerifier verifier;
    private final UserIdentityRepository identityRepository;
    private final AppleTokenRevoker appleTokenRevoker;

    public ReconfirmationService(IdTokenVerifier verifier, UserIdentityRepository identityRepository,
                                 AppleTokenRevoker appleTokenRevoker) {
        this.verifier = verifier;
        this.identityRepository = identityRepository;
        this.appleTokenRevoker = appleTokenRevoker;
    }

    /**
     * @return the verified identity, which is linked to {@code user}
     * @throws ForbiddenException          the proof is missing, bad, or for a different account
     * @throws ServiceUnavailableException the provider could not be reached
     */
    public VerifiedIdentity require(User user, Reconfirmation proof) {
        if (proof == null || !proof.isPresent()) {
            throw new ForbiddenException("Confirm with Apple or Google to continue.", "RECONFIRMATION_REQUIRED");
        }
        IdentityProvider provider = IdentityProvider.fromPath(proof.provider())
                .filter(verifier::isConfigured)
                .orElseThrow(() -> new ForbiddenException("Confirm with Apple or Google to continue.",
                        "RECONFIRMATION_REQUIRED"));

        VerifiedIdentity identity;
        try {
            identity = verifier.verifyForReconfirmation(provider, proof.idToken(), proof.nonce());
        } catch (InvalidIdTokenException e) {
            log.warn("{} re-confirmation refused for user {}: {}", provider, user.getId(), e.getMessage());
            throw new ForbiddenException("We couldn't confirm that " + provider.displayName() + " sign-in. Please try again.");
        } catch (ProviderUnreachableException e) {
            log.warn("{} re-confirmation for user {} could not reach the provider", provider, user.getId());
            throw new ServiceUnavailableException("We couldn't reach " + provider.displayName()
                    + " to confirm it's you. Try again in a moment.");
        }

        boolean linkedHere = identityRepository.findByProviderAndSubject(provider, identity.subject())
                .map(linked -> linked.getUser().getId().equals(user.getId()))
                .orElse(false);
        if (!linkedHere) {
            log.warn("{} re-confirmation refused for user {}: identity is not linked to this login", provider, user.getId());
            throw new ForbiddenException("That " + provider.displayName()
                    + " account isn't the one connected to this login.");
        }
        return identity;
    }

    /**
     * Before an account is deleted: if this login has Apple connected, Huddle's Apple sign-in must be
     * revoked, which needs Apple's one-time code from a re-confirmation WITH APPLE.
     *
     * <p>Runs before anything is deleted. If Apple cannot be reached the deletion does not happen
     * (503, nothing lost, try again); deleting anyway would leave Huddle listed under the person's
     * Apple ID with no way for us to remove it later, since we keep no Apple token.
     *
     * <p>Skipped, with a warning, where revocation is not configured (local dev, a lower without the
     * key). Production must have it configured before Apple sign-in is switched on there.
     */
    public void revokeAppleIfLinked(User user, Reconfirmation proof, VerifiedIdentity reconfirmed) {
        var apple = identityRepository.findByUser_IdAndProvider(user.getId(), IdentityProvider.APPLE);
        if (apple.isEmpty()) {
            return;
        }
        if (!appleTokenRevoker.isConfigured()) {
            log.warn("User {} has Apple connected but Apple revocation is not configured here; deleting without revoking",
                    user.getId());
            return;
        }
        if (reconfirmed == null || reconfirmed.provider() != IdentityProvider.APPLE
                || proof.appleAuthorizationCode() == null || proof.appleAuthorizationCode().isBlank()) {
            throw new ForbiddenException("Confirm with Apple to delete your account. Apple asks apps to"
                    + " disconnect from your Apple ID when you delete your account.", APPLE_RECONFIRMATION_REQUIRED);
        }
        try {
            appleTokenRevoker.revoke(reconfirmed.clientId(), proof.appleAuthorizationCode(),
                    apple.get().getSubject(), proof.appleRedirectUri());
        } catch (AppleTokenRevoker.AppleRevocationException e) {
            log.warn("Apple revocation failed for user {}: {}", user.getId(), e.getMessage());
            throw new ServiceUnavailableException("We couldn't disconnect your Apple ID just now, so nothing"
                    + " was deleted. Try again in a moment.");
        }
    }
}
