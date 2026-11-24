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

    // How weight applies to a set of this exercise (V107). A second axis BESIDE tracking_type, never
    // folded into it: tracking_type answers "what do you count" (reps, seconds, and one day
    // distance), load_type answers "is a weight expected". Kept separate so a future value on either
    // axis (distance; 'none' for a run, 'assisted' for a counterweight machine) is one constant and
    // one CHECK, not a rework of the other.
    //
    // 'external'   -- a weight is expected every set (barbell, dumbbell, machine, weighted dips).
    //                 The default, and what any unrecognised value is read as.
    // 'bodyweight' -- usually just you; the number is weight ADDED on top (a vest, a belt).
    //
    // Unlike tracking_type this HAS a setter: it changes only how the Log screen asks for the first
    // set's weight and what the weight box is called. Every logged set keeps its own weight, and
    // records read that weight, never this column -- so changing it reinterprets nothing.
    public static final String LOAD_TYPE_EXTERNAL = "external";
    public static final String LOAD_TYPE_BODYWEIGHT = "bodyweight";

    // Lenient on purpose: a create is a DURABLE write, and a 400 would discard it (and every set
    // queued behind its temp id) for good. An unknown value -- a newer client's, or a typo -- is
    // read as the safe default instead of refused (backend-core.md, "Validation strictness").
    public static String normalizeLoadType(String loadType) {
        return LOAD_TYPE_BODYWEIGHT.equals(loadType) ? LOAD_TYPE_BODYWEIGHT : LOAD_TYPE_EXTERNAL;
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

    @Column(name = "load_type", nullable = false, length = 20)
    private String loadType = LOAD_TYPE_EXTERNAL;

    @Column(name = "is_deleted", nullable = false)
    private boolean deleted = false;

    // A client-generated idempotency key for an offline-created exercise (see ExerciseService.add).
    // Null for seeded/global exercises and any create without one. Set once at construction, never
    // mutated -- like workout_sets.client_key.
    @Column(name = "client_key", length = 64, updatable = false)
    private String clientKey;

    // Who in the household created this row, or null when nobody did (a preloaded global exercise)
    // or nobody could be determined (a row written by the previous release during a rolling
    // deploy; an account with no OWNER membership). See V67 for why null is meaningful here.
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

    protected Exercise() {
    }

    public Exercise(Account account, String name) {
        this(account, name, null, TRACKING_TYPE_STRENGTH);
    }

    public Exercise(Account account, String name, String clientKey) {
        this(account, name, clientKey, TRACKING_TYPE_STRENGTH);
    }

    public Exercise(Account account, String name, String clientKey, String trackingType) {
        this(account, name, clientKey, trackingType, null);
    }

    public Exercise(Account account, String name, String clientKey, String trackingType, Long createdByUserId) {
        this(account, name, clientKey, trackingType, createdByUserId, LOAD_TYPE_EXTERNAL);
    }

    public Exercise(Account account, String name, String clientKey, String trackingType, Long createdByUserId,
                    String loadType) {
        this.account = account;
        this.name = name;
        this.clientKey = clientKey;
        this.trackingType = trackingType;
        this.createdByUserId = createdByUserId;
        this.loadType = normalizeLoadType(loadType);
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

    public String getLoadType() {
        return loadType;
    }

    public void setLoadType(String loadType) {
        this.loadType = normalizeLoadType(loadType);
    }

    public boolean isDeleted() {
        return deleted;
    }

    public void setDeleted(boolean deleted) {
        this.deleted = deleted;
    }

    public Long getCreatedByUserId() {
        return createdByUserId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
