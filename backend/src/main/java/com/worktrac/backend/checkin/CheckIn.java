package com.worktrac.backend.checkin;

import com.worktrac.backend.person.Person;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * A dated entry about a PERSON — not about a set, and not about an exercise.
 *
 * <p>One table serves two uses, told apart by {@link #visibleToPerson}: a manager's private
 * observation (false) and a check-in the person can see (true, including every one they wrote
 * themselves). They are the same grain, so they share a table, a timeline read and a component.
 *
 * <p>⚠️ <b>This is the THIRD note concept in the codebase and the naming is the real risk.</b>
 * {@code person_exercise.note} is the "standing note" on one exercise; {@code session_exercise_notes}
 * is the "note for this session". Neither is about a person and neither is ever private. The
 * user-facing surface here is called <b>Check-ins</b> and never uses the word "note" as a label —
 * see {@code .claude/rules/coaching.md}.
 */
@Entity
@Table(name = "check_ins")
public class CheckIn {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private Person person;

    /**
     * Who wrote it. Null is legitimate — a login removed since — and every consumer renders that as
     * naming nobody rather than printing "null".
     */
    @Column(name = "author_user_id")
    private Long authorUserId;

    /**
     * The date this is ABOUT, which is not always when it was typed: a trainer catching up on Sunday
     * still records Friday. {@link #createdAt} keeps the audit trail separately.
     */
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "entered_at", nullable = false)
    private Instant enteredAt;

    @Column(name = "body_weight", precision = 6, scale = 2)
    private BigDecimal bodyWeight;

    @Column(name = "body_weight_unit", length = 2)
    private String bodyWeightUnit;

    @Column(length = 2000)
    private String note;

    /**
     * ⚠️ The ONLY thing separating a private observation from a shared one. A read that forgets to
     * consult it shows a client what their trainer wrote about them, which is the single worst
     * failure this table can produce — so the filtering lives in ONE repository query
     * ({@code CheckInRepository.findVisibleTo}) rather than at each call site.
     */
    @Column(name = "visible_to_person", nullable = false)
    private boolean visibleToPerson = true;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected CheckIn() {
    }

    public CheckIn(Person person, Long authorUserId, Instant enteredAt, BigDecimal bodyWeight,
                   String bodyWeightUnit, String note, boolean visibleToPerson, Instant createdAt) {
        this.person = person;
        this.authorUserId = authorUserId;
        this.enteredAt = enteredAt;
        // Kept as a pair, like every other weight in this schema: a weight with no unit is
        // uninterpretable, so a null weight clears the unit rather than leaving a stray one behind.
        this.bodyWeight = bodyWeight;
        this.bodyWeightUnit = bodyWeight == null ? null : bodyWeightUnit;
        this.note = note;
        this.visibleToPerson = visibleToPerson;
        this.createdAt = createdAt;
    }

    public Long getId() {
        return id;
    }

    public Person getPerson() {
        return person;
    }

    public Long getAuthorUserId() {
        return authorUserId;
    }

    public Instant getEnteredAt() {
        return enteredAt;
    }

    public BigDecimal getBodyWeight() {
        return bodyWeight;
    }

    public String getBodyWeightUnit() {
        return bodyWeightUnit;
    }

    public String getNote() {
        return note;
    }

    public boolean isVisibleToPerson() {
        return visibleToPerson;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
