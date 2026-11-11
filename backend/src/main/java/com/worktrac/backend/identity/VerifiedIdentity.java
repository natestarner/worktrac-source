package com.worktrac.backend.identity;

/**
 * What a provider vouched for, after {@link IdTokenVerifier} checked the token's signature, issuer,
 * audience, age and nonce.
 *
 * @param subject       the provider's stable, never-reused id for this person. THE identity.
 * @param email         the address the provider holds, lower-cased; may be null (a token is not
 *                      required to carry one, and is refused for sign-UP without one)
 * @param emailVerified the provider's own claim that it verified {@code email}
 * @param privateRelay  Apple's "Hide My Email" relay address
 * @param clientId      which of this environment's client ids the token was minted for
 */
public record VerifiedIdentity(IdentityProvider provider, String subject, String email,
                               boolean emailVerified, boolean privateRelay, String clientId) {
}
