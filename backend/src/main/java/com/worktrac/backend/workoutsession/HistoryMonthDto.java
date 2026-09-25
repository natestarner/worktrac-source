package com.worktrac.backend.workoutsession;

import java.util.List;

// One month of History and the fingerprint that describes exactly this content -- the client sends
// the fingerprint back on its next sync, and gets the month again only if it no longer matches.
// `sessions` is newest first and may be empty (a month whose only workout has no sets yet).
public record HistoryMonthDto(String fp, List<HistorySessionDto> sessions) {
}
