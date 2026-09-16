package com.worktrac.backend.routine;

import com.worktrac.backend.exercise.Exercise;
import java.math.BigDecimal;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "routine_exercises")
public class RoutineExercise {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "routine_id", nullable = false)
    private Routine routine;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "exercise_id", nullable = false)
    private Exercise exercise;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    // ── Prescribed targets (V77) ───────────────────────────────────────────────────────────────
    //
    // What the trainer wants hit. All three null for every routine exercise that exists today and
    // every one a person builds for themselves -- "no target" is the default and stays it.
    //
    // ⚠️ THE UNIT IS STAMPED BESIDE THE WEIGHT, exactly as workout_sets does and for the same
    // reason: it must never be recomputed when the account's default unit changes later. A target
    // of 100 entered in kg does not become 100 lb because somebody flipped a setting. The DB
    // enforces the pair (CK_routine_exercises_target_unit) because a half-written target renders as
    // a number with no idea what it means.
    //
    // A PRESCRIPTION, NOT A LIMIT. Nothing anywhere validates a logged set against these, and
    // nothing should: a client who lifts more than prescribed has had a good day, not made an
    // error, and refusing the set would be the app arguing with the gym floor.
    @Column(name = "target_weight", precision = 6, scale = 2)
    private BigDecimal targetWeight;

    @Column(name = "target_reps")
    private Integer targetReps;

    @Column(name = "target_unit", length = 2)
    private String targetUnit;

    protected RoutineExercise() {
    }

    public RoutineExercise(Routine routine, Exercise exercise, int sortOrder) {
        this.routine = routine;
        this.exercise = exercise;
        this.sortOrder = sortOrder;
    }

    public Long getId() {
        return id;
    }

    public Routine getRoutine() {
        return routine;
    }

    public Exercise getExercise() {
        return exercise;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    public BigDecimal getTargetWeight() {
        return targetWeight;
    }

    public Integer getTargetReps() {
        return targetReps;
    }

    public String getTargetUnit() {
        return targetUnit;
    }

    /**
     * Sets or clears the prescribed target — all three together, never one at a time.
     *
     * <p>⚠️ One setter, because a weight without a unit is uninterpretable and a unit without a
     * weight is noise. The DB check constraint refuses the broken pairings outright; this is what
     * stops a caller reaching one half of them.
     *
     * <p>Passing a null weight clears the unit too, so "remove the target" cannot leave a stray
     * unit behind that a later edit would re-pair with a different number.
     */
    public void setTarget(BigDecimal weight, Integer reps, String unit) {
        this.targetWeight = weight;
        this.targetReps = reps;
        this.targetUnit = weight == null ? null : unit;
    }
}
