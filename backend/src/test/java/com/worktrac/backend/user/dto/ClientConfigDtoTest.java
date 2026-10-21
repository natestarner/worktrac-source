package com.worktrac.backend.user.dto;

import com.worktrac.backend.config.NativeAppProperties;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

// No Spring context: what NATIVE_MIN_SUPPORTED_BUILD / NATIVE_APP_STORE_URL become on /me.
class ClientConfigDtoTest {

    @Test
    void carriesTheConfiguredMinimumAndStoreLink() {
        NativeAppProperties properties = new NativeAppProperties();
        properties.setMinSupportedBuild(57);
        properties.setAppStoreUrl("https://apps.apple.com/app/id123");

        ClientConfigDto dto = ClientConfigDto.from(properties);

        assertEquals(57, dto.minSupportedNativeBuild());
        assertEquals("https://apps.apple.com/app/id123", dto.appStoreUrl());
    }

    // An env var set but empty binds as null; the client must still get a string it can test for
    // emptiness rather than a null it has to special-case.
    @Test
    void anUnsetStoreLinkIsAnEmptyStringNeverNull() {
        NativeAppProperties properties = new NativeAppProperties();
        properties.setAppStoreUrl(null);

        assertEquals("", ClientConfigDto.from(properties).appStoreUrl());
        assertEquals(0, ClientConfigDto.from(properties).minSupportedNativeBuild());
    }
}
