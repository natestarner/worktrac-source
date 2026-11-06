package com.worktrac.backend.exercise;

/**
 * Asks the video's host whether a video can still be embedded. An interface so tests can answer
 * without the network; the real one is {@link YouTubeOembedProbe}.
 */
public interface VideoAvailabilityProbe {

    enum Availability {
        /** The host answered: the video exists, is public, and may be embedded. */
        AVAILABLE,
        /** The host answered: removed, private, or embedding turned off. */
        UNAVAILABLE,
        /** No definite answer (timeout, 5xx, rate limit). Changes nothing. */
        UNKNOWN
    }

    Availability check(String videoId);
}
