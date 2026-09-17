package com.worktrac.backend.person;

import java.math.BigDecimal;

// weightIncrement/durationIncrementSeconds ride /api/auth/me like restTimerEnabled does, which is
// what makes them correct on a cold offline boot: the whole /me payload is written to the client's
// auth snapshot, so the Log screen steps by the right amount with no network.
public record PersonDto(Long id, String name, boolean isPrimary, boolean restTimerEnabled,
                        BigDecimal weightIncrement, int durationIncrementSeconds) {

    public static PersonDto from(Person person) {
        return new PersonDto(person.getId(), person.getName(), person.isPrimary(), person.isRestTimerEnabled(),
                person.getWeightIncrement(), person.getDurationIncrementSeconds());
    }
}
