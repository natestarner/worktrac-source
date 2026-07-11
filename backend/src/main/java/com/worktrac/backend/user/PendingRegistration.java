package com.worktrac.backend.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

@Entity
@Table(name = "pending_registrations")
public class PendingRegistration {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 255)
    private String email;

    @Column(name = "account_name", length = 255)
    private String accountName;

    @Column(name = "person_name", nullable = false, length = 255)
    private String personName;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "code_hash", nullable = false, length = 255)
    private String codeHash;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "last_sent_at", nullable = false)
    private Instant lastSentAt;

    @Column(name = "resend_count", nullable = false)
    private int resendCount;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected PendingRegistration() {
    }

    public PendingRegistration(String email, String accountName, String personName, String passwordHash,
                                String codeHash, Instant expiresAt, Instant now) {
        this.email = email;
        this.accountName = accountName;
        this.personName = personName;
        this.passwordHash = passwordHash;
        this.codeHash = codeHash;
        this.expiresAt = expiresAt;
        this.attemptCount = 0;
        this.lastSentAt = now;
        this.resendCount = 0;
    }

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public Long getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getAccountName() {
        return accountName;
    }

    public String getPersonName() {
        return personName;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public String getCodeHash() {
        return codeHash;
    }

    public void setCodeHash(String codeHash) {
        this.codeHash = codeHash;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public void incrementAttemptCount() {
        this.attemptCount++;
    }

    public void resetAttemptCount() {
        this.attemptCount = 0;
    }

    public Instant getLastSentAt() {
        return lastSentAt;
    }

    public void setLastSentAt(Instant lastSentAt) {
        this.lastSentAt = lastSentAt;
    }

    public int getResendCount() {
        return resendCount;
    }

    public void incrementResendCount() {
        this.resendCount++;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
