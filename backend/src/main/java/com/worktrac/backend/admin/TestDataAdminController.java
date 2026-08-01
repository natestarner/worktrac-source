package com.worktrac.backend.admin;

import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Deliberately its own controller, not folded into AdminController -- @Profile({"local",
// "lower"}) means this bean, and therefore these two routes, DO NOT EXIST AT ALL outside those
// profiles. That's the real safety net (this can never run in production, full stop), not just
// a UI that hides the button there -- the same two-layer defense already established for the
// e2e test-support endpoint (see TestSupportController). Still gated by the existing
// /api/admin/** -> hasRole('ADMIN') rule in SecurityConfig regardless of which controller class
// serves the route.
@RestController
@RequestMapping("/api/admin/test-data")
@Profile({"local", "lower"})
public class TestDataAdminController {

    private final TestDataCleanupService cleanupService;

    public TestDataAdminController(TestDataCleanupService cleanupService) {
        this.cleanupService = cleanupService;
    }

    @GetMapping("/preview")
    public AdminTestDataPreviewDto preview() {
        return cleanupService.preview();
    }

    @DeleteMapping
    public AdminTestDataPreviewDto deleteAll() {
        return cleanupService.deleteAll();
    }
}
