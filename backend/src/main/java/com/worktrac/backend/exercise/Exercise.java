package com.worktrac.backend.exercise;

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
@Table(name = "exercises")
public class Exercise {

    // What a set of this exercise measures. 'strength' is weight x reps; 'duration' is added load
    // x seconds held (plank, wall sit, dead hang, a loaded carry). V46 replaced the never-used
    // 'cardio' value with 'duration' -- see that migration for why.
    //
    // Deliberately has NO setter: sets already logged against this exercise were recorded under one
    // reading of their numbers, and flipping the type would silently reinterpret every one of them.
    // ExerciseService.update (rename) must never touch it.
    public static final String TRACKING_TYPE_STRENGTH = "strength";
    public static final String TRACKING_TYPE_DURATION = "duration";

    public static boolean isValidTrackingType(String trackingType) {
        return TRACKING_TYPE_STRENGTH.equals(trackingType) || TRACKING_TYPE_DURATION.equals(trackingType);
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // null = system exercise, shared by every account
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "account_id")
    private Account account;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "tracking_type", nullable = false, length = 20)
    private String trackingType = TRACKING_TYPE_STRENGTH;

    @Column(name = "is_deleted", nullable = false)
    private boolean deleted = false;

    // A client-generated idempotency key for an offline-created exercise (see ExerciseService.add).
    // Null for seeded/global exercises and any create without one. Set once at construction, never
    // mutated -- like workout_sets.client_key.
    @Column(name = "client_key", length = 64, updatable = false)
    private String clientKey;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Exercise() {
    }

    public Exercise(Account account, String name) {
        this(account, name, null, TRACKING_TYPE_STRENGTH);
    }

    public Exercise(Account account, String name, String clientKey) {
        this(account, name, clientKey, TRACKING_TYPE_STRENGTH);
    }

    public Exercise(Account account, String name, String clientKey, String trackingType) {
        this.account = account;
        this.name = name;
        this.clientKey = clientKey;
        this.trackingType = trackingType;
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

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getTrackingType() {
        return trackingType;
    }

    public boolean isDurationTracked() {
        return TRACKING_TYPE_DURATION.equals(trackingType);
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
}
