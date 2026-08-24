package com.worktrac.backend.csvimport;

import com.worktrac.backend.person.Person;
import com.worktrac.backend.user.User;
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

// One committed import. The sets, sessions and session notes it created carry its id (V54), which
// is the only thing that makes an import distinguishable after the fact -- an imported set is
// otherwise identical to a hand-logged one, which is the point.
//
// Scoped to a person, not an account: an import targets exactly one person, and undo re-checks
// that ownership on every row it touches rather than trusting the stamp alone.
@Entity
@Table(name = "import_batches")
public class ImportBatch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private Person person;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by_user_id", nullable = false)
    private User createdByUser;

    @Column(length = 255)
    private String filename;

    @Column(name = "set_count", nullable = false)
    private int setCount;

    @Column(name = "session_count", nullable = false)
    private int sessionCount;

    @Column(name = "skipped_duplicate_count", nullable = false)
    private int skippedDuplicateCount;

    // Soft: the row stays as a record of what came in and went back out. Undo is not offered
    // twice for the same batch, and the counts remain readable.
    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "undone_at")
    private Instant undoneAt;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected ImportBatch() {
    }

    public ImportBatch(Person person, User createdByUser, String filename, int setCount, int sessionCount,
                        int skippedDuplicateCount, Instant createdAt) {
        this.person = person;
        this.createdByUser = createdByUser;
        this.filename = filename;
        this.setCount = setCount;
        this.sessionCount = sessionCount;
        this.skippedDuplicateCount = skippedDuplicateCount;
        this.createdAt = createdAt;
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

    public User getCreatedByUser() {
        return createdByUser;
    }

    public String getFilename() {
        return filename;
    }

    public int getSetCount() {
        return setCount;
    }

    public int getSessionCount() {
        return sessionCount;
    }

    public int getSkippedDuplicateCount() {
        return skippedDuplicateCount;
    }

    public Instant getUndoneAt() {
        return undoneAt;
    }

    public void setUndoneAt(Instant undoneAt) {
        this.undoneAt = undoneAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public boolean isUndone() {
        return undoneAt != null;
    }
}
