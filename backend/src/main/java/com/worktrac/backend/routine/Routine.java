package com.worktrac.backend.routine;

import com.worktrac.backend.person.Person;
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

@Entity
@Table(name = "routines")
public class Routine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private Person person;

    @Column(nullable = false, length = 200)
    private String name;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    // Where this routine sits in its person's own list -- a preference they set by dragging on
    // the Routines tab, not a derived value. Zero-based, dense within a person, and assigned by
    // RoutineService (append at the end on create/copy, by list position on reorder). Backfilled
    // from created_at in V62 so existing households saw no change when ordering shipped.
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @OneToMany(mappedBy = "routine", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC")
    private List<RoutineExercise> exercises = new ArrayList<>();

    protected Routine() {
    }

    public Routine(Person person, String name) {
        this.person = person;
        this.name = name;
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

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    public List<RoutineExercise> getExercises() {
        return exercises;
    }
}
