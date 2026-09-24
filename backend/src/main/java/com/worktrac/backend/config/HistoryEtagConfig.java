package com.worktrac.backend.config;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

import java.util.regex.Pattern;

// An ETag on `/api/people/{id}/history`, so an unchanged history costs a 304 with no body instead
// of the whole thing again. The client refetches History after every logged set and on every
// wake/5-minute warm for each person it keeps offline (offlineCacheWarm.js), and at years of daily
// training the response is megabytes -- almost all of those refetches return exactly what the
// device already holds.
//
// SHALLOW on purpose: the tag is a hash of the exact response bytes, computed after the controller
// has built them, so a 304 is only ever sent when the response would have been byte-for-byte what
// the client already has. There is no version stamp to keep in step with the write paths -- a set,
// a note, a session edit, an import, an exercise rename (History carries names) and the Free-tier
// window all change the bytes, so they all change the tag, including any write path added later.
// The cost is that the server still does the full read on every request; only the transfer is
// saved. A cheaper "version stamp" tag would skip the read too, but one missed write path would
// then serve a stale History with a 304, which is exactly the failure this must not have.
//
// Registered as a servlet filter, so it runs INSIDE Spring Security's chain: authentication and the
// person guard have already passed by the time a tag is computed, and an error response (non-2xx)
// is never tagged. The client half is api/sessions.js#getHistory. HistoryEtagTest pins both.
@Configuration
public class HistoryEtagConfig {

    private static final Pattern HISTORY_PATH = Pattern.compile("^/api/people/\\d+/history$");

    @Bean
    public FilterRegistrationBean<ShallowEtagHeaderFilter> historyEtagFilter() {
        ShallowEtagHeaderFilter filter = new ShallowEtagHeaderFilter() {
            @Override
            protected boolean shouldNotFilter(HttpServletRequest request) {
                return !"GET".equals(request.getMethod()) || !HISTORY_PATH.matcher(request.getRequestURI()).matches();
            }
        };
        // WEAK (W/"..."), because Tomcat refuses to gzip a response carrying a STRONG tag
        // (noCompressionStrongETag): a strong tag vouches for the exact bytes, and compression
        // changes them. A weak tag means "same content", which is what this is -- and If-None-Match
        // uses weak comparison, so it validates the same either way. HistoryEtagTest pins that a
        // compressed History still gets its 304.
        filter.setWriteWeakETag(true);
        FilterRegistrationBean<ShallowEtagHeaderFilter> registration = new FilterRegistrationBean<>(filter);
        // Servlet URL patterns cannot wildcard a middle segment, so this is the broad match and
        // shouldNotFilter above narrows it to the one endpoint.
        registration.addUrlPatterns("/api/people/*");
        registration.setName("historyEtagFilter");
        return registration;
    }
}
