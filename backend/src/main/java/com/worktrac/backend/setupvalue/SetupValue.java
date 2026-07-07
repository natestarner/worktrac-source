package com.worktrac.backend.setupvalue;

import com.worktrac.backend.exercise.ExerciseSetupField;
import com.worktrac.backend.person.Person;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

@Entity
@Table(name = "setup_values")
public class SetupValue {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private Person person;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "exercise_setup_field_id", nullable = false)
    private ExerciseSetupField field;

    @Column(nullable = false, length = 200)
    private String value;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected SetupValue() {
    }

    public SetupValue(Person person, ExerciseSetupField field, String value) {
        this.person = person;
        this.field = field;
        this.value = value;
    }

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public Person getPerson() {
        return person;
    }

    public ExerciseSetupField getField() {
        return field;
    }

    // Used only when forking a system exercise -- re-points this value from the
    // original exercise's field to the matching field on the account-owned fork.
    public void setField(ExerciseSetupField field) {
        this.field = field;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
