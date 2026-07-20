package com.worktrac.backend.person;

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
@Table(name = "people")
public class Person {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(name = "is_primary", nullable = false)
    private boolean primary;

    // Whether the on-screen rest timer is shown for this person (a per-person preference persisted
    // account-side so it's consistent across devices; see V39). Defaults on. Controls display only
    // -- rest_seconds is recorded regardless.
    @Column(name = "rest_timer_enabled", nullable = false)
    private boolean restTimerEnabled = true;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Person() {
    }

    public Person(Account account, String name, boolean primary) {
        this.account = account;
        this.name = name;
        this.primary = primary;
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

    public boolean isPrimary() {
        return primary;
    }

    public boolean isRestTimerEnabled() {
        return restTimerEnabled;
    }

    public void setRestTimerEnabled(boolean restTimerEnabled) {
        this.restTimerEnabled = restTimerEnabled;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
