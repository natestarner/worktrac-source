package com.worktrac.backend.workoutsession;

import java.util.List;
import java.util.Map;

// The History sync's reply (WorkoutSessionService#syncHistory).
//
// `scope` null -- an ordinary sync: `months` is every month ('yyyy-mm', newest first) the client
// should hold afterwards, and a month it holds that is not listed is gone.
//
// `scope` present -- a scoped sync (HistorySyncRequest#at): the reply speaks ONLY for the months in
// `scope`. Of those, `months` lists the ones that still exist (a scoped month not listed is gone);
// every month outside `scope` is untouched and stays exactly as the client holds it.
//
// Either way, `changed` carries content only for listed months whose fingerprint differs from the
// one the client sent; every other listed month is exactly what the client already has.
public record HistorySyncDto(List<String> months, Map<String, HistoryMonthDto> changed, List<String> scope) {

    public HistorySyncDto(List<String> months, Map<String, HistoryMonthDto> changed) {
        this(months, changed, null);
    }
}
