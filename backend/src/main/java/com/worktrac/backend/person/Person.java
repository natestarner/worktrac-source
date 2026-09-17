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

import java.math.BigDecimal;
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

    // How much this person's +/- stepper buttons move the weight and a hold's duration (V79).
    // Deliberately unit-agnostic: a step size is not a weight, so one number applies whether the
    // set is being logged in lb or kg. The defaults match the values these were hardcoded to
    // before they became a preference.
    @Column(name = "weight_increment", nullable = false, precision = 5, scale = 2)
    private BigDecimal weightIncrement = new BigDecimal("2.5");

    @Column(name = "duration_increment_seconds", nullable = false)
    private int durationIncrementSeconds = 5;

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

    public BigDecimal getWeightIncrement() {
        return weightIncrement;
    }

    public void setWeightIncrement(BigDecimal weightIncrement) {
        this.weightIncrement = weightIncrement;
    }

    public int getDurationIncrementSeconds() {
        return durationIncrementSeconds;
    }

    public void setDurationIncrementSeconds(int durationIncrementSeconds) {
        this.durationIncrementSeconds = durationIncrementSeconds;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
