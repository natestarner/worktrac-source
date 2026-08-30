package com.worktrac.backend.quota;

import com.worktrac.backend.common.ForbiddenException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

// Plain unit test -- QuotaService depends only on QuotaProperties, a simple POJO.
//
// The exception TYPE is being pinned as much as the refusal itself. ForbiddenException maps to 403,
// which shouldRetryWrite treats as terminal; a TooManyRequestsException (429) would be in its
// RETRYABLE_4XX set and would make a durable write replay forever against a ceiling that never
// moves -- the same poison-message shape the @Size caps were added to remove.
class QuotaServiceTest {

    private QuotaService quotaService;

    @BeforeEach
    void setUp() {
        QuotaProperties properties = new QuotaProperties();
        properties.setPeoplePerAccount(10);
        properties.setExercisesPerAccount(10);
        properties.setTagsPerAccount(10);
        properties.setRoutinesPerPerson(10);
        properties.setCustomFieldsPerExercise(10);
        properties.setSetsPerAccount(100);
        quotaService = new QuotaService(properties);
    }

    @Test
    void belowTheLimitIsAllowed() {
        assertDoesNotThrow(() -> quotaService.requirePersonCapacity(1L, 9));
    }

    // At the limit, not over it: the count is what exists BEFORE the write, so a household already
    // holding exactly `limit` rows must not be able to add one more.
    @Test
    void atTheLimitIsRefused() {
        assertThrows(ForbiddenException.class, () -> quotaService.requirePersonCapacity(1L, 10));
    }

    @Test
    void everyQuotaRefusesWithForbiddenRatherThanTooManyRequests() {
        assertThrows(ForbiddenException.class, () -> quotaService.requireExerciseCapacity(1L, 10));
        assertThrows(ForbiddenException.class, () -> quotaService.requireTagCapacity(1L, 10));
        assertThrows(ForbiddenException.class, () -> quotaService.requireRoutineCapacity(1L, 2L, 10));
        assertThrows(ForbiddenException.class, () -> quotaService.requireCustomFieldCapacity(1L, 10));
    }

    // The set ceiling counts the WHOLE incoming batch, so one import cannot vault over it in a
    // single transaction the way a per-row check would allow.
    @Test
    void anImportThatWouldCrossTheSetCeilingIsRefusedAsAWhole() {
        assertDoesNotThrow(() -> quotaService.requireSetCapacity(1L, 60, 40));
        assertThrows(ForbiddenException.class, () -> quotaService.requireSetCapacity(1L, 60, 41));
    }

    @Test
    void anImportWellUnderTheCeilingIsAllowed() {
        assertDoesNotThrow(() -> quotaService.requireSetCapacity(1L, 0, 20));
    }
}
