package com.worktrac.backend.exercise;

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

// A custom setup field a person added to an exercise. Because it belongs to a per-person
// PersonExercise row, the recorded value lives inline here -- no setup_values row needed, so
// the shared exercise's base fields/values are never touched.
@Entity
@Table(name = "person_exercise_fields")
public class PersonExerciseField {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_exercise_id", nullable = false)
    private PersonExercise personExercise;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 200)
    private String value;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected PersonExerciseField() {
    }

    public PersonExerciseField(PersonExercise personExercise, String name, int sortOrder) {
        this.personExercise = personExercise;
        this.name = name;
        this.sortOrder = sortOrder;
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

    public PersonExercise getPersonExercise() {
        return personExercise;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
