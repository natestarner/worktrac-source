package com.worktrac.backend.membership;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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

// The join between a credential and a household: "this login may act inside this account, in this
// role, as this person" (V63).
//
// Replaces users.account_id, which made one email mean one household forever. The point of the
// split is that a person can now belong to more than one account with a single password -- a kid
// who later pays for their own, or a parent who is also a coach on a team account.
@Entity
@Table(name = "account_memberships")
public class AccountMembership {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    // Which Person this login IS. Nullable and legitimately so -- an owner need not correspond to
    // a person, and removing a person must not silently delete someone's way into the household.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "person_id")
    private Person person;

    // STRING, never ORDINAL: an ordinal mapping makes the meaning of every stored row depend on
    // the declaration order of the enum, so inserting a role in the middle later would silently
    // re-interpret existing memberships.
    @Enumerated(EnumType.STRING)
    @Column(name = "account_role", nullable = false, length = 20)
    private AccountRole accountRole = AccountRole.MEMBER;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected AccountMembership() {
    }

    public AccountMembership(Account account, User user, Person person, AccountRole accountRole) {
        this.account = account;
        this.user = user;
        this.person = person;
        this.accountRole = accountRole;
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

    public User getUser() {
        return user;
    }

    public Person getPerson() {
        return person;
    }

    public AccountRole getAccountRole() {
        return accountRole;
    }

    public void setAccountRole(AccountRole accountRole) {
        this.accountRole = accountRole;
    }

    // Set when a login is attached to a person, and cleared if that person is removed. Deliberately
    // not part of the constructor contract for updates -- the membership outlives the person.
    public void setPerson(Person person) {
        this.person = person;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
