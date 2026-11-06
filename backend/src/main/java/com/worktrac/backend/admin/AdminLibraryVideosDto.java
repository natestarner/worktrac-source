package com.worktrac.backend.admin;

import java.time.Instant;
import java.util.List;

// The library's how-to-video coverage, for the admin portal's Videos tab: how many library exercises
// have a video, and which ones don't, most-used first. Read-only, like every admin read but the three
// sanctioned writes (admin-portal.md); adding a video stays a reviewed CSV and a migration
// (docs/exercise-videos/README.md).
//
// reason: "none" (no video was ever found -- most are Muscle & Strength's site-locked Vimeo clips)
// or "unavailable" (ExerciseVideoChecker hid it after YouTube said it was gone; videoId is the dead
// id and checkedAt when that was decided).
public record AdminLibraryVideosDto(int libraryCount, int withVideoCount, List<Missing> missing) {

    public record Missing(long exerciseId, String name, String reason, String videoId, Instant checkedAt,
                          int peopleUsing) {
    }
}
