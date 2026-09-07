package com.worktrac.backend.account;

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
@Table(name = "accounts")
public class Account {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "default_unit", nullable = false, length = 2)
    private String defaultUnit = "lb";

    // Whether a MEMBER login sees the whole household or only themselves (V66).
    //
    // ⚠️ NO SETTER, DELIBERATELY. Pro/Family is forced ON, and the absence of a setter is what
    // enforces that -- there is no endpoint, no service method and no UI that can change it, so
    // "always on for this plan" is a property of the code rather than a check to be flipped. The
    // Team tier is what adds a setter, an endpoint and a toggle together. See V66's header.
    @Column(name = "members_see_everyone", nullable = false)
    private boolean membersSeeEveryone = true;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Account() {
    }

    public Account(String name) {
        this.name = name;
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

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDefaultUnit() {
        return defaultUnit;
    }

    public void setDefaultUnit(String defaultUnit) {
        this.defaultUnit = defaultUnit;
    }

    public boolean isMembersSeeEveryone() {
        return membersSeeEveryone;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
