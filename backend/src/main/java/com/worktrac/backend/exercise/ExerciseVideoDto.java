package com.worktrac.backend.exercise;

// A library exercise's how-to video, as the client needs it: which provider, the video's id there,
// where the demonstration starts, and who made it. Never a URL -- the client builds the one URL it
// uses (its own /embed/youtube.html page), so nothing in a row can point the player elsewhere.
//
// Only 'active' videos are sent (V94). An exercise with no video, or whose video the checker found
// unavailable, carries null; a client from before videos ignores the field.
public record ExerciseVideoDto(
        String provider,
        String videoId,
        Integer startSeconds,
        String sourceLabel
) {
}
