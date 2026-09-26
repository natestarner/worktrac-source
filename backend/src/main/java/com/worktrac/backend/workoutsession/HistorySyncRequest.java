package com.worktrac.backend.workoutsession;

import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.Map;

// The months ('yyyy-mm') the client already holds, each with the fingerprint it was sent with.
// Absent or empty means "send everything". A key that is not a month the person has is simply
// ignored -- it can never match, so the reply's month list drops it on the client.
//
// `sessions` and `at` SCOPE the sync to what a write on this device just touched: the ids of the
// workouts it wrote to, and the start times the device HOLDS for them. The server checks only the
// months those start times fall in, plus the month each workout is in NOW -- the two differ when the
// workout was moved to another date elsewhere, and reloading only the held month would drop it from
// the device (or only the current one, show it twice). The server works out every month itself; the
// client never computes one. Absent or empty means the ordinary all-months check, and both are
// ignored when nothing is held: a full sync is a full sync.
//
// Bounded, since all three are client-supplied: 2,400 months is two hundred years of History, and no
// write touches more than a couple of workouts.
public record HistorySyncRequest(@Size(max = 2400) Map<String, String> have,
                                 @Size(max = 8) List<Long> sessions,
                                 @Size(max = 8) List<Instant> at) {
}
