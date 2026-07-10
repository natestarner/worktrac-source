package com.worktrac.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.Status;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;

class AuthWarmupHealthIndicatorTest {

    @Test
    void reportsUpAfterARealEncodeVerifyRoundTrip() {
        AuthWarmupHealthIndicator indicator = new AuthWarmupHealthIndicator(new BCryptPasswordEncoder());

        assertThat(indicator.health().getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void reportsDownIfTheEncoderThrows() {
        PasswordEncoder broken = new PasswordEncoder() {
            @Override
            public String encode(CharSequence rawPassword) {
                throw new IllegalStateException("boom");
            }

            @Override
            public boolean matches(CharSequence rawPassword, String encodedPassword) {
                return false;
            }
        };
        AuthWarmupHealthIndicator indicator = new AuthWarmupHealthIndicator(broken);

        assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
    }

    @Test
    void reportsDownIfTheRoundTripDoesNotVerify() {
        PasswordEncoder mismatched = new PasswordEncoder() {
            @Override
            public String encode(CharSequence rawPassword) {
                return "hashed";
            }

            @Override
            public boolean matches(CharSequence rawPassword, String encodedPassword) {
                return false;
            }
        };
        AuthWarmupHealthIndicator indicator = new AuthWarmupHealthIndicator(mismatched);

        assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
    }

    @Test
    void onlyRunsTheRealEncodeOnceThenReportsUpWithoutRedoingTheWork() {
        int[] encodeCalls = {0};
        PasswordEncoder counting = new PasswordEncoder() {
            @Override
            public String encode(CharSequence rawPassword) {
                encodeCalls[0]++;
                return "hashed";
            }

            @Override
            public boolean matches(CharSequence rawPassword, String encodedPassword) {
                return true;
            }
        };
        AuthWarmupHealthIndicator indicator = new AuthWarmupHealthIndicator(counting);

        Health first = indicator.health();
        Health second = indicator.health();
        Health third = indicator.health();

        assertThat(encodeCalls[0]).isEqualTo(1);
        assertThat(first.getStatus()).isEqualTo(Status.UP);
        assertThat(second.getStatus()).isEqualTo(Status.UP);
        assertThat(third.getStatus()).isEqualTo(Status.UP);
    }
}
