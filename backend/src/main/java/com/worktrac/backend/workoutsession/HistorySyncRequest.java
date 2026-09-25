package com.worktrac.backend.workoutsession;

import jakarta.validation.constraints.Size;

import java.util.Map;

// The months ('yyyy-mm') the client already holds, each with the fingerprint it was sent with.
// Absent or empty means "send everything". A key that is not a month the person has is simply
// ignored -- it can never match, so the reply's month list drops it on the client.
//
// Bounded, since it is client-supplied: 2,400 months is two hundred years of History.
public record HistorySyncRequest(@Size(max = 2400) Map<String, String> have) {
}
