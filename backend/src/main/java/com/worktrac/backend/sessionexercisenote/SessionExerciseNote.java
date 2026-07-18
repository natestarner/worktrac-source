package com.worktrac.backend.sessionexercisenote;

import com.worktrac.backend.exercise.Exercise;
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

import java.time.Instant;

// A note about how a specific exercise went in a specific workout session -- one optional
// row per (session, exercise) pair, since an exercise "in a session" otherwise only exists
// implicitly as the workout_sets rows sharing that pair. Distinct from the standing,
// per-person note on PersonExercise: this one is scoped to a single workout.
@Entity
@Table(name = "session_exercise_notes")
public class SessionExerciseNote {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private WorkoutSession session;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "exercise_id", nullable = false)
    private Exercise exercise;

    @Column(nullable = false, length = 1000)
    private String note;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected SessionExerciseNote() {
    }

    public SessionExerciseNote(WorkoutSession session, Exercise exercise, String note) {
        this.session = session;
        this.exercise = exercise;
        this.note = note;
    }

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
    }

    public Long getId() {
        return id;
    }

    public WorkoutSession getSession() {
        return session;
    }

    public Exercise getExercise() {
        return exercise;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
        this.updatedAt = Instant.now();
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
