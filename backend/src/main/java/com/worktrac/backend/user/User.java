package com.worktrac.backend.user;

import com.worktrac.backend.account.Account;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @Column(nullable = false, length = 255)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    // 'USER' or 'ADMIN'. The env-driven ADMIN_EMAILS allowlist is the real source of
    // truth (see AdminProperties) -- this column is a cache reconciled at login and at
    // startup, never edited directly.
    @Column(nullable = false, length = 20)
    private String role = "USER";

    // Temporary lockout after repeated wrong passwords (V58). Persisted rather than held in
    // memory because an in-process counter resets on restart and every replica would keep its own,
    // handing an attacker a fresh allowance from whichever instance answers.
    @Column(name = "failed_login_attempts", nullable = false)
    private int failedLoginAttempts;

    // A timestamp, not a flag: the lockout expires by the clock on its own, so there is no unlock
    // endpoint to build and secure and no support path for a family member who mistyped.
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "locked_until")
    private Instant lockedUntil;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected User() {
    }

    public User(Account account, String email, String passwordHash) {
        this.account = account;
        this.email = email;
        this.passwordHash = passwordHash;
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

    public Account getAccount() {
        return account;
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void updatePasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public int getFailedLoginAttempts() {
        return failedLoginAttempts;
    }

    public Instant getLockedUntil() {
        return lockedUntil;
    }

    public boolean isLockedAt(Instant now) {
        return lockedUntil != null && lockedUntil.isAfter(now);
    }

    public void recordFailedLogin(int maxAttempts, Instant now, java.time.Duration lockoutDuration) {
        failedLoginAttempts++;
        if (failedLoginAttempts >= maxAttempts) {
            lockedUntil = now.plus(lockoutDuration);
            // Reset rather than leave it at the cap, so the next wrong password after the lockout
            // expires starts a fresh count instead of re-locking on a single attempt.
            failedLoginAttempts = 0;
        }
    }

    // Called on a successful login AND on a successful password reset. The reset case is what
    // makes lockout acceptable on a shared household login: the instinctive response to being
    // locked out is to reset the password, and that must let them straight back in rather than
    // leaving them locked out holding a password that now works.
    public void clearLoginLockout() {
        failedLoginAttempts = 0;
        lockedUntil = null;
    }

    public String getRole() {
        return role;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
