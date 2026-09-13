package com.worktrac.backend.tag;

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

// A tag in the household's shared tagging vocabulary. Tags belong to the account, so everyone
// in the household picks from the same free-text set; which exercises each person tags stays
// per-person (person_exercise_tags). Replaces the per-person "categories" concept.
@Entity
@Table(name = "tags")
public class Tag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @Column(nullable = false, length = 100)
    private String name;

    // Who in the household created this tag, or null when that cannot be determined: a row written
    // by the previous release during a rolling deploy, or an account with no OWNER membership for
    // V69 to attribute to. (Unlike exercises there is no shared global catalog here -- every tag
    // belongs to exactly one household -- so those two are the only ways a null arises.) See V67
    // for why null is meaningful rather than merely unbacked.
    //
    // A raw id, not a @ManyToOne User: the only question ever asked of it is "is this
    // access.userId()", and mapping the association would drag the whole User aggregate into the
    // catalog for a comparison. Same shape as BillingEvent.accountId and import_batch_id.
    //
    // Set once at construction, never mutated -- transferring authorship is not a thing the
    // product does, and a setter would be the obvious way to do it by accident.
    @Column(name = "created_by_user_id", updatable = false)
    private Long createdByUserId;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Tag() {
    }

    // No unstamped convenience constructor on purpose: TagService.getOrCreate is the only place a
    // tag is ever built, and every caller of it knows who is asking. An overload defaulting the
    // creator to null would make "forgot to attribute this" the path of least resistance, and a
    // null creator is exactly what locks a member out of their own tag.
    public Tag(Account account, String name, Long createdByUserId) {
        this.account = account;
        this.name = name;
        this.createdByUserId = createdByUserId;
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

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Long getCreatedByUserId() {
        return createdByUserId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
