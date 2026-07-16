package com.worktrac.backend.exercise;

import com.worktrac.backend.person.Person;
import com.worktrac.backend.personcategory.PersonCategory;
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

// One person's personalization of a shared exercise, layered on top without ever mutating the
// exercise row. Holds whether it's favorited (shows in their picker) and which of their own
// categories they filed it under, plus any custom setup fields they added. A person's picker
// list = these favorites UNION every exercise they have a logged set for.
@Entity
@Table(name = "person_exercise")
public class PersonExercise {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private Person person;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "exercise_id", nullable = false)
    private Exercise exercise;

    @Column(name = "is_favorite", nullable = false)
    private boolean favorite = false;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "person_category_id")
    private PersonCategory category;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @OneToMany(mappedBy = "personExercise", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC")
    private List<PersonExerciseField> customFields = new ArrayList<>();

    protected PersonExercise() {
    }

    public PersonExercise(Person person, Exercise exercise) {
        this.person = person;
        this.exercise = exercise;
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

    public Person getPerson() {
        return person;
    }

    public Exercise getExercise() {
        return exercise;
    }

    public boolean isFavorite() {
        return favorite;
    }

    public void setFavorite(boolean favorite) {
        this.favorite = favorite;
    }

    public PersonCategory getCategory() {
        return category;
    }

    public void setCategory(PersonCategory category) {
        this.category = category;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public List<PersonExerciseField> getCustomFields() {
        return customFields;
    }
}
