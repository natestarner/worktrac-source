package com.worktrac.backend.registrationaudit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

// Single-row table (id is always 1 -- see V45 migration) holding admin-configurable toggles for
// which registration event categories trigger an alert email. This is the one admin-portal
// endpoint that mutates data -- a deliberate, narrow exception to the "admin portal is
// read-only" invariant elsewhere in this app (see AdminService/AdminController class
// comments): it's alerting *configuration*, not application data.
@Entity
@Table(name = "registration_alert_settings")
public class RegistrationAlertSettings {

    @Id
    private Long id;

    @Column(name = "alert_on_registration_confirmed", nullable = false)
    private boolean alertOnRegistrationConfirmed;

    @Column(name = "alert_on_send_failure", nullable = false)
    private boolean alertOnSendFailure;

    @Column(name = "alert_on_delivery_failure", nullable = false)
    private boolean alertOnDeliveryFailure;

    // Contact Us submissions (V52). Defaults ON, unlike alertOnRegistrationConfirmed: a contact
    // message is a deliberate, rate-limited action by an authenticated household member, so the
    // volume is inherently low and every one of them is worth hearing about.
    @Column(name = "alert_on_contact_message", nullable = false)
    private boolean alertOnContactMessage;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected RegistrationAlertSettings() {
    }

    public Long getId() {
        return id;
    }

    public boolean isAlertOnRegistrationConfirmed() {
        return alertOnRegistrationConfirmed;
    }

    public void setAlertOnRegistrationConfirmed(boolean alertOnRegistrationConfirmed) {
        this.alertOnRegistrationConfirmed = alertOnRegistrationConfirmed;
    }

    public boolean isAlertOnSendFailure() {
        return alertOnSendFailure;
    }

    public void setAlertOnSendFailure(boolean alertOnSendFailure) {
        this.alertOnSendFailure = alertOnSendFailure;
    }

    public boolean isAlertOnDeliveryFailure() {
        return alertOnDeliveryFailure;
    }

    public void setAlertOnDeliveryFailure(boolean alertOnDeliveryFailure) {
        this.alertOnDeliveryFailure = alertOnDeliveryFailure;
    }

    public boolean isAlertOnContactMessage() {
        return alertOnContactMessage;
    }

    public void setAlertOnContactMessage(boolean alertOnContactMessage) {
        this.alertOnContactMessage = alertOnContactMessage;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
