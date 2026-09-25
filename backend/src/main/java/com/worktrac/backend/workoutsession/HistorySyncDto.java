package com.worktrac.backend.workoutsession;

import java.util.List;
import java.util.Map;

// The History sync's reply (WorkoutSessionService#syncHistory).
//
// `months` is every month ('yyyy-mm', newest first) the client should hold afterwards -- a month it
// holds that is not listed is gone. `changed` carries content only for listed months whose
// fingerprint differs from the one the client sent; every other listed month is exactly what the
// client already has.
public record HistorySyncDto(List<String> months, Map<String, HistoryMonthDto> changed) {
}
