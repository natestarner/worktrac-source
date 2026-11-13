package com.worktrac.backend.email;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertTrue;

// Gmail strips CSS `transform`. The success emails' checkmark used to be two borders of a box
// rotated 45 degrees; in Gmail it rendered as an unrotated "L" (2026-11-13). Any shape built from a
// transform breaks the same way, so no email template may use one. `text-transform` is unaffected
// and allowed -- the lookbehind keeps it out of the match.
class EmailTemplateCssTest {

    private static final Pattern CSS_TRANSFORM = Pattern.compile("(?<![-\\w])transform\\s*:");

    @Test
    void noEmailTemplateUsesCssTransform() throws IOException {
        Resource[] templates = new PathMatchingResourcePatternResolver()
                .getResources("classpath:templates/email/*.html");
        assertTrue(templates.length >= 6, "expected to find the email templates, found " + templates.length);

        List<String> offenders = new ArrayList<>();
        for (Resource template : templates) {
            String html = new String(template.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (CSS_TRANSFORM.matcher(html).find()) {
                offenders.add(template.getFilename());
            }
        }
        assertTrue(offenders.isEmpty(), "CSS transform (stripped by Gmail) in: " + offenders);
    }
}
