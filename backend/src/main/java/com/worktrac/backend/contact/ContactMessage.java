package com.worktrac.backend.contact;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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

// One suggestion or bug report from the in-app Contact Us page. See V51 for why this row commits
// synchronously and the alert email is dispatched only afterwards.
//
// submitterEmail is copied from the authenticated user rather than accepted from the form: the
// form has no email field at all, so there is no path by which a submitter can claim to be someone
// else, and nothing user-controlled ever reaches an email header.
@Entity
@Table(name = "contact_messages")
public class ContactMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    // Nullable: the active person is a client-side notion and a submission is still meaningful
    // without one (nothing selected yet, or a brand-new household).
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "person_id")
    private Person person;

    @Column(name = "submitter_email", nullable = false, length = 255)
    private String submitterEmail;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ContactCategory category;

    @Column(nullable = false, length = 150)
    private String subject;

    @Column(nullable = false, length = 4000)
    private String message;

    @Column(name = "app_build", length = 40)
    private String appBuild;

    @Column(length = 80)
    private String screen;

    @Column(name = "user_agent", length = 255)
    private String userAgent;

    @Column(name = "was_online")
    private Boolean wasOnline;

    @Column(name = "unsynced_writes")
    private Integer unsyncedWrites;

    @Column(name = "correlation_id", length = 64)
    private String correlationId;

    @Column(name = "client_error", length = 2000)
    private String clientError;

    @Column(name = "ip_address", length = 45)
    private String ipAddress;

    @Enumerated(EnumType.STRING)
    @Column(name = "alert_status", nullable = false, length = 16)
    private ContactAlertStatus alertStatus = ContactAlertStatus.PENDING;

    @Column(name = "alert_message_id", length = 100)
    private String alertMessageId;

    @Column(name = "alert_detail", length = 1000)
    private String alertDetail;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "alert_updated_at")
    private Instant alertUpdatedAt;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected ContactMessage() {
    }

    public ContactMessage(Account account, User user, Person person, String submitterEmail,
                           ContactCategory category, String subject, String message, Instant createdAt) {
        this.account = account;
        this.user = user;
        this.person = person;
        this.submitterEmail = submitterEmail;
        this.category = category;
        this.subject = subject;
        this.message = message;
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

    public Account getAccount() {
        return account;
    }

    public User getUser() {
        return user;
    }

    public Person getPerson() {
        return person;
    }

    public String getSubmitterEmail() {
        return submitterEmail;
    }

    public ContactCategory getCategory() {
        return category;
    }

    public String getSubject() {
        return subject;
    }

    public String getMessage() {
        return message;
    }

    public String getAppBuild() {
        return appBuild;
    }

    public void setAppBuild(String appBuild) {
        this.appBuild = appBuild;
    }

    public String getScreen() {
        return screen;
    }

    public void setScreen(String screen) {
        this.screen = screen;
    }

    public String getUserAgent() {
        return userAgent;
    }

    public void setUserAgent(String userAgent) {
        this.userAgent = userAgent;
    }

    public Boolean getWasOnline() {
        return wasOnline;
    }

    public void setWasOnline(Boolean wasOnline) {
        this.wasOnline = wasOnline;
    }

    public Integer getUnsyncedWrites() {
        return unsyncedWrites;
    }

    public void setUnsyncedWrites(Integer unsyncedWrites) {
        this.unsyncedWrites = unsyncedWrites;
    }

    public String getCorrelationId() {
        return correlationId;
    }

    public void setCorrelationId(String correlationId) {
        this.correlationId = correlationId;
    }

    public String getClientError() {
        return clientError;
    }

    public void setClientError(String clientError) {
        this.clientError = clientError;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public void setIpAddress(String ipAddress) {
        this.ipAddress = ipAddress;
    }

    public ContactAlertStatus getAlertStatus() {
        return alertStatus;
    }

    public void setAlertStatus(ContactAlertStatus alertStatus) {
        this.alertStatus = alertStatus;
    }

    public String getAlertMessageId() {
        return alertMessageId;
    }

    public void setAlertMessageId(String alertMessageId) {
        this.alertMessageId = alertMessageId;
    }

    public String getAlertDetail() {
        return alertDetail;
    }

    public void setAlertDetail(String alertDetail) {
        this.alertDetail = alertDetail;
    }

    public Instant getAlertUpdatedAt() {
        return alertUpdatedAt;
    }

    public void setAlertUpdatedAt(Instant alertUpdatedAt) {
        this.alertUpdatedAt = alertUpdatedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
