package com.worktrac.backend.workoutset;

import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.workoutsession.WorkoutSession;
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

// Named WorkoutSet (not Set) to avoid clashing with java.util.Set.
@Entity
@Table(name = "workout_sets")
public class WorkoutSet {

    public static final String UNIT_LB = "lb";
    public static final String UNIT_KG = "kg";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private WorkoutSession session;

    // Denormalized from session.person for query convenience; app-layer invariant that
    // it always matches session.getPerson().
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private Person person;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "exercise_id", nullable = false)
    private Exercise exercise;

    @Column(nullable = false, precision = 6, scale = 2)
    private BigDecimal weight;

    @Column(nullable = false)
    private int reps;

    // Seconds held, for a set of a duration-tracked exercise (V47). Null for every strength set.
    // When this is set, reps is 0 -- a hold genuinely has zero repetitions, which keeps volume
    // (weight * reps) and totalReps correct with no null handling. CK_workout_sets_duration_reps
    // (V48) enforces that pairing.
    //
    // What marks a row as a hold is its EXERCISE's tracking_type, never reps == 0 -- 0 is also a
    // legal strength value (a failed set).
    @Column(name = "duration_seconds")
    private Integer durationSeconds;

    @Column(nullable = false, length = 2)
    private String unit;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    // Seconds of rest before this set, snapshotted once at insert time -- see the
    // V17 migration and WorkoutSetService.insertSetAndDetectPr for the full rule (live
    // sets only, null for the first set of an exercise in a session). Deliberately has
    // no setter: it must never be recomputed after the fact (e.g. from editSet, or if an
    // earlier/later set is edited or deleted), since it records what actually happened
    // at the time, not a live-derived value. Never set this from anywhere but the
    // constructor.
    @Column(name = "rest_seconds", updatable = false)
    private Integer restSeconds;

    // Client-generated idempotency key (see V40/V41). Unique when present; lets a retried/replayed
    // log-set be deduped by the service. Null for historical rows and any write without one.
    @Column(name = "client_key", length = 64, updatable = false)
    private String clientKey;

    protected WorkoutSet() {
    }

    public WorkoutSet(WorkoutSession session, Person person, Exercise exercise, BigDecimal weight, int reps, String unit,
                       Integer restSeconds, Instant createdAt, String clientKey) {
        this(session, person, exercise, weight, reps, null, unit, restSeconds, createdAt, clientKey);
    }

    public WorkoutSet(WorkoutSession session, Person person, Exercise exercise, BigDecimal weight, int reps,
                       Integer durationSeconds, String unit, Integer restSeconds, Instant createdAt, String clientKey) {
        this.session = session;
        this.person = person;
        this.exercise = exercise;
        this.weight = weight;
        this.reps = reps;
        this.durationSeconds = durationSeconds;
        this.unit = unit;
        this.restSeconds = restSeconds;
        // May be null -> prePersist falls back to now(). When supplied (the client's real logging
        // time) it's honored so a delayed/offline sync keeps an accurate created_at.
        this.createdAt = createdAt;
        this.clientKey = clientKey;
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

    public WorkoutSession getSession() {
        return session;
    }

    public Person getPerson() {
        return person;
    }

    public Exercise getExercise() {
        return exercise;
    }

    public BigDecimal getWeight() {
        return weight;
    }

    public void setWeight(BigDecimal weight) {
        this.weight = weight;
    }

    public int getReps() {
        return reps;
    }

    public void setReps(int reps) {
        this.reps = reps;
    }

    public Integer getDurationSeconds() {
        return durationSeconds;
    }

    public void setDurationSeconds(Integer durationSeconds) {
        this.durationSeconds = durationSeconds;
    }

    public String getUnit() {
        return unit;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Integer getRestSeconds() {
        return restSeconds;
    }

    public String getClientKey() {
        return clientKey;
    }
}
