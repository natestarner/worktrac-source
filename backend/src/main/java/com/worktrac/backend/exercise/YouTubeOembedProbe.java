package com.worktrac.backend.exercise;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.regex.Pattern;

/**
 * Checks a YouTube video through YouTube's public oEmbed endpoint -- the same lookup a site makes
 * to show a link preview. No API key, no quota, nothing about the person.
 *
 * <p>What the answers mean:
 * <ul>
 *   <li>200 -- public and embeddable (measured 2026-11-06 against a real id).</li>
 *   <li>400 -- no such video (measured the same day: a well-formed id that does not exist answers
 *       400, not 404; our request is fixed-format, so a 400 can only be about the video).</li>
 *   <li>401 / 403 -- embedding turned off, or a private video; 404 -- removed. These follow
 *       YouTube's oEmbed behaviour as documented by others and were NOT reproduced here, which is
 *       why only a definite answer acts and anything else is UNKNOWN.</li>
 *   <li>anything else, or no answer -- UNKNOWN. A YouTube outage must never hide every video.</li>
 * </ul>
 */
@Component
public class YouTubeOembedProbe implements VideoAvailabilityProbe {

    private static final Logger log = LoggerFactory.getLogger(YouTubeOembedProbe.class);

    // The same rule as frontend/public/embed/youtube.js: only an 11-character id is ever looked up,
    // so nothing in a row can turn this into a request for anything else.
    private static final Pattern VIDEO_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    @Override
    public Availability check(String videoId) {
        if (videoId == null || !VIDEO_ID.matcher(videoId).matches()) {
            return Availability.UNAVAILABLE;
        }
        String watch = "https://www.youtube.com/watch?v=" + videoId;
        URI uri = URI.create("https://www.youtube.com/oembed?format=json&url="
                + URLEncoder.encode(watch, StandardCharsets.UTF_8));
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(15)).GET().build();
        try {
            int status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            return switch (status) {
                case 200 -> Availability.AVAILABLE;
                case 400, 401, 403, 404 -> Availability.UNAVAILABLE;
                default -> Availability.UNKNOWN;
            };
        } catch (IOException e) {
            log.info("Video check for {} got no answer: {}", videoId, e.getMessage());
            return Availability.UNKNOWN;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Availability.UNKNOWN;
        }
    }
}
