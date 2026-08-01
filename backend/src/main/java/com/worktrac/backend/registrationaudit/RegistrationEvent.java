package com.worktrac.backend.registrationaudit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

@Entity
@Table(name = "registration_events")
public class RegistrationEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 255)
    private String email;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, length = 40)
    private RegistrationEventType eventType;

    @Column(name = "detail", length = 1000)
    private String detail;

    @Column(name = "ip_address", length = 45)
    private String ipAddress;

    @Column(name = "message_id", length = 100)
    private String messageId;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected RegistrationEvent() {
    }

    public RegistrationEvent(String email, RegistrationEventType eventType, String detail, String ipAddress,
                              String messageId, Instant createdAt) {
        this.email = email;
        this.eventType = eventType;
        this.detail = detail;
        this.ipAddress = ipAddress;
        this.messageId = messageId;
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

    public String getEmail() {
        return email;
    }

    public RegistrationEventType getEventType() {
        return eventType;
    }

    public String getDetail() {
        return detail;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public String getMessageId() {
        return messageId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
