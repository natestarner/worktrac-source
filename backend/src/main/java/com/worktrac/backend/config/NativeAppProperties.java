package com.worktrac.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

// What the server tells the App Store app about itself (see ClientConfigDto, served on /me).
//
// minSupportedBuild: an app whose build number is below this shows "Update Huddle". It is a soft
// banner, never a gate -- an old build keeps logging and its outbox keeps draining. 0 (the default)
// means every build is supported. Raise it only after a change the old builds genuinely cannot
// survive, and only after checking which builds are live (docs/azure-read-only-access.md).
//
// appStoreUrl: where the banner sends people. Empty until the App Store listing exists; the banner
// then explains without a link.
//
// Both come from the Container App's env vars in the deploy repo, like every other per-environment
// setting; neither is a secret.
@Component
@ConfigurationProperties(prefix = "app.native")
public class NativeAppProperties {

    private int minSupportedBuild = 0;
    private String appStoreUrl = "";

    public int getMinSupportedBuild() {
        return minSupportedBuild;
    }

    public void setMinSupportedBuild(int minSupportedBuild) {
        this.minSupportedBuild = minSupportedBuild;
    }

    public String getAppStoreUrl() {
        return appStoreUrl;
    }

    public void setAppStoreUrl(String appStoreUrl) {
        this.appStoreUrl = appStoreUrl == null ? "" : appStoreUrl;
    }
}
