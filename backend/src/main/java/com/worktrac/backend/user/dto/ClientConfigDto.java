package com.worktrac.backend.user.dto;

import com.worktrac.backend.config.NativeAppProperties;

// Rides on /me rather than a second endpoint, for the same two reasons `accounts` does (MeResponse):
// /me is what every app open already calls, and it is persisted in the auth snapshot -- so an app
// opened offline still knows the last minimum it was told, instead of forgetting it.
//
// Additive: a client that predates it ignores it, and a snapshot that predates it reads as "no
// minimum known", which shows no banner.
public record ClientConfigDto(int minSupportedNativeBuild, String appStoreUrl) {

    public static ClientConfigDto from(NativeAppProperties properties) {
        return new ClientConfigDto(properties.getMinSupportedBuild(), properties.getAppStoreUrl());
    }
}
