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
    // ⚠️ THE SETTER IS GATED BY A PLAN, NOT BY ITS OWN ABSENCE. It shipped with no setter at all,
    // which made "forced ON for a family tier" a property of the code rather than a check somebody
    // could flip -- and V66's header said the tier that needed it would add the setter, the
    // endpoint and the toggle together. Pro is that tier, and this is that setter.
    //
    // What replaces the absence is PlanFeature.PRIVATE_MEMBERS: a plan that does not hold it cannot
    // reach the endpoint at all, so Free and Plus are still forced ON -- now by an explicit gate
    // that says WHY rather than by a missing method that says nothing. Do not call this from
    // anywhere but AccountService.setMemberVisibility, which is where that gate lives.
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

    public void setMembersSeeEveryone(boolean membersSeeEveryone) {
        this.membersSeeEveryone = membersSeeEveryone;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
