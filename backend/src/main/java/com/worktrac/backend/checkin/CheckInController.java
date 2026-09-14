package com.worktrac.backend.checkin;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Check-ins for one person.
 *
 * <p>{@code personScoped = true} on every route: the interceptor cannot answer these, because
 * whether you may read this person's check-ins — and which of them — depends on who they are to
 * you. {@code CheckInService} does it through the same {@code PersonService} guards every other
 * per-person route uses.
 */
@RestController
@RequestMapping("/api/people/{personId}/check-ins")
public class CheckInController {

    private final CheckInService checkInService;
    private final CurrentUser currentUser;

    public CheckInController(CheckInService checkInService, CurrentUser currentUser) {
        this.checkInService = checkInService;
        this.currentUser = currentUser;
    }

    @GetMapping
    @RequiresPermission(personScoped = true)
    public List<CheckInDto> list(@PathVariable Long personId) {
        return checkInService.list(currentUser.access(), personId);
    }

    @PostMapping
    @RequiresPermission(personScoped = true)
    public CheckInDto add(@PathVariable Long personId, @Valid @RequestBody CheckInRequest request) {
        return checkInService.add(currentUser.access(), personId, request);
    }

    @DeleteMapping("/{checkInId}")
    @RequiresPermission(personScoped = true)
    public ResponseEntity<Void> remove(@PathVariable Long personId, @PathVariable Long checkInId) {
        checkInService.remove(currentUser.access(), personId, checkInId);
        return ResponseEntity.noContent().build();
    }
}
