package com.worktrac.backend.membership;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.person.Person;
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

/**
 * An outstanding invitation for one person in one household to get their own login.
 *
 * <p>Shaped like {@link com.worktrac.backend.user.PendingRegistration} because it is the same kind
 * of thing: a half-finished identity operation, proved by a hashed secret sent to an email address,
 * bounded by an expiry, an attempt ceiling and a resend cooldown.
 *
 * <p><b>The email is a plain field, not a user reference.</b> An invite names an ADDRESS, and it
 * must behave identically whether or not that address already has a Huddle account — see
 * {@code MembershipInviteService} for why anything else is a user-enumeration oracle. The address
 * is resolved to a user exactly once, at accept time, and never recorded here in the meantime.
 */
@Entity
@Table(name = "membership_invites")
public class MembershipInvite {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private Person person;

    @Column(nullable = false, length = 255)
    private String email;

    /**
     * BCrypt of the emailed token — never the token itself.
     *
     * <p>It is a bearer credential: whoever holds it can attach a login to this household. A
     * readable copy here is the same mistake as storing a password, and this table is reachable by
     * every backup, export and support query the account table is.
     */
    @Column(name = "token_hash", nullable = false, length = 255)
    private String tokenHash;

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

    /**
     * Null until accepted.
     *
     * <p>Kept rather than deleted: "was this invite accepted, and when" has to stay answerable
     * after the fact — the owner's notification and the audit trail both need it — and the filtered
     * unique index in V71 is what lets an accepted row sit alongside a fresh pending one.
     */
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "accepted_at")
    private Instant acceptedAt;

    @Column(name = "invited_by_user_id")
    private Long invitedByUserId;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected MembershipInvite() {
    }

    public MembershipInvite(Account account, Person person, String email, String tokenHash,
                            Instant expiresAt, Instant sentAt, Long invitedByUserId) {
        this.account = account;
        this.person = person;
        this.email = email;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.lastSentAt = sentAt;
        this.invitedByUserId = invitedByUserId;
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

    public Person getPerson() {
        return person;
    }

    public String getEmail() {
        return email;
    }

    public String getTokenHash() {
        return tokenHash;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public void recordFailedAttempt() {
        attemptCount += 1;
    }

    public Instant getLastSentAt() {
        return lastSentAt;
    }

    public int getResendCount() {
        return resendCount;
    }

    /** A resend replaces the secret outright, so a link already in an inbox stops working. */
    public void resent(String newTokenHash, Instant expiresAt, Instant sentAt) {
        this.tokenHash = newTokenHash;
        this.expiresAt = expiresAt;
        this.lastSentAt = sentAt;
        this.resendCount += 1;
        // Deliberately resets the attempt ceiling: it exists to stop guessing at ONE secret, and
        // this is a different one. Not resetting it would let a few bad guesses permanently
        // poison an invitation the owner can otherwise reissue freely.
        this.attemptCount = 0;
    }

    public Instant getAcceptedAt() {
        return acceptedAt;
    }

    public boolean isAccepted() {
        return acceptedAt != null;
    }

    public void accept(Instant at) {
        this.acceptedAt = at;
    }

    public Long getInvitedByUserId() {
        return invitedByUserId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
