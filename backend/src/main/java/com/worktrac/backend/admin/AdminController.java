package com.worktrac.backend.admin;

import org.springframework.boot.health.actuate.endpoint.HealthEndpoint;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.util.List;

// Every route here is gated by SecurityConfig (/api/admin/** -> hasRole('ADMIN')), so
// unlike every other controller in the app it deliberately does NOT scope by
// CurrentUser.accountId() -- that's the entire point of this controller.
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final AdminService adminService;
    private final HealthEndpoint healthEndpoint;
    private final Clock clock;

    public AdminController(AdminService adminService, HealthEndpoint healthEndpoint, Clock clock) {
        this.adminService = adminService;
        this.healthEndpoint = healthEndpoint;
        this.clock = clock;
    }

    @GetMapping("/overview")
    public AdminOverviewDto overview() {
        return adminService.overview();
    }

    @GetMapping("/accounts")
    public List<AdminAccountDto> accounts() {
        return adminService.listAccounts();
    }

    @GetMapping("/people")
    public List<AdminPersonDto> people() {
        return adminService.listPeople();
    }

    @GetMapping("/pending-registrations")
    public List<AdminPendingRegistrationDto> pendingRegistrations() {
        return adminService.listPendingRegistrations();
    }

    @GetMapping("/health")
    public AdminHealthDto health() {
        String status = healthEndpoint.health().getStatus().getCode();
        return new AdminHealthDto(status, clock.instant());
    }
}
