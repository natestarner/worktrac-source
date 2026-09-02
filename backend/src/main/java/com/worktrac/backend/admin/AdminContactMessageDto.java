package com.worktrac.backend.admin;

import com.worktrac.backend.contact.ContactMessage;

import java.time.Instant;

// Every field here is curated deliberately -- admin DTOs must never carry a hashed value or any
// credential material, and the join to User/Account makes that easy to do by accident.
//
// correlationId is the field that earns its place at triage time: paste it into the Log Analytics
// query in docs/azure-read-only-access.md to get this person's actual request trail.
public record AdminContactMessageDto(
        Long id,
        String submitterEmail,
        String accountName,
        String personName,
        String category,
        String subject,
        String message,
        String appBuild,
        String screen,
        String userAgent,
        Boolean wasOnline,
        Integer unsyncedWrites,
        String correlationId,
        String clientError,
        String bootFailure,
        String ipAddress,
        String alertStatus,
        String alertDetail,
        Instant createdAt) {

    public static AdminContactMessageDto from(ContactMessage m) {
        return new AdminContactMessageDto(
                m.getId(),
                m.getSubmitterEmail(),
                m.getAccount() == null ? null : m.getAccount().getName(),
                m.getPerson() == null ? null : m.getPerson().getName(),
                m.getCategory().name(),
                m.getSubject(),
                m.getMessage(),
                m.getAppBuild(),
                m.getScreen(),
                m.getUserAgent(),
                m.getWasOnline(),
                m.getUnsyncedWrites(),
                m.getCorrelationId(),
                m.getClientError(),
                m.getBootFailure(),
                m.getIpAddress(),
                m.getAlertStatus().name(),
                m.getAlertDetail(),
                m.getCreatedAt());
    }
}
