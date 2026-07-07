package com.worktrac.backend.exercise;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.category.Category;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "exercises")
public class Exercise {

    public static final String TRACKING_TYPE_STRENGTH = "strength";
    public static final String TRACKING_TYPE_CARDIO = "cardio";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // null = system exercise, shared by every account
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "account_id")
    private Account account;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "category_id", nullable = false)
    private Category category;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "tracking_type", nullable = false, length = 20)
    private String trackingType = TRACKING_TYPE_STRENGTH;

    @Column(name = "is_deleted", nullable = false)
    private boolean deleted = false;

    // Set only on an account-owned exercise that was forked from a shared system
    // exercise on first edit/delete -- lets the visibility query hide the original
    // global row from this account without touching it for anyone else.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "forked_from_id")
    private Exercise forkedFrom;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @OneToMany(mappedBy = "exercise", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC")
    private List<ExerciseSetupField> setupFields = new ArrayList<>();

    protected Exercise() {
    }

    public Exercise(Account account, Category category, String name) {
        this.account = account;
        this.category = category;
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

    public Account getAccount() {
        return account;
    }

    public boolean isGlobal() {
        return account == null;
    }

    public Category getCategory() {
        return category;
    }

    public void setCategory(Category category) {
        this.category = category;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getTrackingType() {
        return trackingType;
    }

    public boolean isDeleted() {
        return deleted;
    }

    public void setDeleted(boolean deleted) {
        this.deleted = deleted;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Exercise getForkedFrom() {
        return forkedFrom;
    }

    public void setForkedFrom(Exercise forkedFrom) {
        this.forkedFrom = forkedFrom;
    }

    public List<ExerciseSetupField> getSetupFields() {
        return setupFields;
    }
}
