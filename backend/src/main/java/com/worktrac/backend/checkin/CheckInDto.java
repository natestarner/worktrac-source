package com.worktrac.backend.checkin;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One check-in as the client sees it.
 *
 * <p>{@code authorName} is a NAME and nothing more — the same contract {@code MembershipDto.ownerName}
 * and {@code ExerciseDto.createdByName} carry. Null is legitimate (a login removed since) and every
 * consumer renders that as naming nobody.
 *
 * <p>⚠️ {@code visibleToPerson} is included on purpose, and it is the trainer's own signal that a
 * note is private — the entry they are reading may be one the client will never see, and a surface
 * that did not show which was which would have a trainer write a private observation in the
 * client-visible slot sooner or later.
 */
public record CheckInDto(Long id, Instant enteredAt, BigDecimal bodyWeight, String bodyWeightUnit,
                         String note, boolean visibleToPerson, String authorName, boolean authoredByYou) {

    public static CheckInDto from(CheckIn checkIn, String authorName, Long viewerUserId) {
        return new CheckInDto(
                checkIn.getId(),
                checkIn.getEnteredAt(),
                checkIn.getBodyWeight(),
                checkIn.getBodyWeightUnit(),
                checkIn.getNote(),
                checkIn.isVisibleToPerson(),
                authorName,
                checkIn.getAuthorUserId() != null && checkIn.getAuthorUserId().equals(viewerUserId));
    }
}
