package com.worktrac.backend.outbox;

import com.worktrac.backend.config.JwtProperties;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

// Encrypts outbox payloads at rest. A payload can carry a raw verification code, a password-reset
// code or an invite token -- the very secrets their own tables store only as BCrypt hashes -- so a
// plaintext outbox would undo that for as long as a row sits there (and for as long as a backup of
// it is kept). Payloads are also nulled the moment a row is SENT or FAILED, so this guards the
// seconds-to-minutes a row is PENDING.
//
// AES-256-GCM, a fresh 12-byte IV per payload, stored as base64(iv || ciphertext+tag).
//
// The key is derived from APP_JWT_SECRET (HMAC-SHA256 over a fixed label) rather than a new secret:
// every environment already has it, it is already a secret of the right strength, and the label
// keeps the derived key unrelated to the JWT signing key. Rotating APP_JWT_SECRET makes rows that
// are PENDING at that moment undecryptable -- the dispatcher marks them FAILED with that reason, and
// at this app's volume that is at most a handful of rows.
@Component
public class OutboxPayloadCipher {

    private static final String LABEL = "huddle-outbox-payload-v1";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public OutboxPayloadCipher(JwtProperties jwtProperties) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            this.key = new SecretKeySpec(mac.doFinal(LABEL.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Could not derive the outbox payload key", e);
        }
    }

    public String encrypt(String plaintext) {
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(iv.length + sealed.length)
                    .put(iv).put(sealed).array());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Could not encrypt an outbox payload", e);
        }
    }

    public String decrypt(String stored) throws GeneralSecurityException {
        byte[] all = Base64.getDecoder().decode(stored);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, all, 0, IV_BYTES));
        return new String(cipher.doFinal(all, IV_BYTES, all.length - IV_BYTES), StandardCharsets.UTF_8);
    }
}
