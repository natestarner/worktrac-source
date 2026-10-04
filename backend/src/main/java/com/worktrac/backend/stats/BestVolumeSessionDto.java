package com.worktrac.backend.stats;

import java.time.Instant;
import java.util.List;

// The session that holds this exercise's session-volume record, for the Log screen's "Last time"
// card to show beside the last session. Same shape as LastSessionDto minus the note: the card only
// shows a note for the last session, and fetching one here would cost getSummary a second query.
public record BestVolumeSessionDto(Long sessionId, Instant startedAt, List<SetSummaryDto> sets) {
}
