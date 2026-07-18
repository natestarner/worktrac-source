package com.worktrac.backend.exercise;

import com.worktrac.backend.person.Person;
import com.worktrac.backend.tag.Tag;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

// One person's personalization of a shared exercise, layered on top without ever mutating the
// exercise row. Holds whether it's favorited (shows in their picker), which of the household's
// shared tags they've applied to it, any custom setup fields they added, and a standing note
// (also shows in their picker -- see PersonExerciseService.listForPerson). A person's picker
// list = these favorites UNION noted exercises UNION every exercise they have a logged set for.
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

    // A standing reminder for this exercise, shown to this person every session (e.g.
    // "keep elbows tucked", "go light -- bad knee"). Distinct from a session note, which
    // is scoped to a single workout -- see the sessionexercisenote package.
    @Column(length = 1000)
    private String note;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "person_exercise_tags",
            joinColumns = @JoinColumn(name = "person_exercise_id"),
            inverseJoinColumns = @JoinColumn(name = "tag_id"))
    private Set<Tag> tags = new HashSet<>();

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

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public Set<Tag> getTags() {
        return tags;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public List<PersonExerciseField> getCustomFields() {
        return customFields;
    }
}
