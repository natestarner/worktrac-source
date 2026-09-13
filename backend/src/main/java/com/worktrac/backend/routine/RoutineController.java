package com.worktrac.backend.routine;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class RoutineController {

    private final RoutineService routineService;
    private final CurrentUser currentUser;

    public RoutineController(RoutineService routineService, CurrentUser currentUser) {
        this.routineService = routineService;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/people/{personId}/routines")
    @RequiresPermission(personScoped = true)
    public List<RoutineDto> list(@PathVariable Long personId) {
        return routineService.list(currentUser.access(), personId);
    }

    @PostMapping("/api/people/{personId}/routines")
    @RequiresPermission(personScoped = true)
    public RoutineDto create(@PathVariable Long personId, @Valid @RequestBody RoutineRequest request) {
        return routineService.create(currentUser.access(), personId, request);
    }

    @PutMapping("/api/people/{personId}/routines/{routineId}")
    @RequiresPermission(personScoped = true)
    public RoutineDto update(@PathVariable Long personId, @PathVariable Long routineId,
                              @Valid @RequestBody RoutineRequest request) {
        return routineService.update(currentUser.access(), personId, routineId, request);
    }

    // Its own endpoint rather than an overload of update: RoutineRequest carries name +
    // exerciseIds, so reordering through it would rewrite every routine's exercise membership
    // to do the work of moving one row.
    @PutMapping("/api/people/{personId}/routines/order")
    @RequiresPermission(personScoped = true)
    public List<RoutineDto> reorder(@PathVariable Long personId, @Valid @RequestBody ReorderRoutinesRequest request) {
        return routineService.reorder(currentUser.access(), personId, request);
    }

    @PostMapping("/api/people/{personId}/routines/{routineId}/copy")
    @RequiresPermission(personScoped = true)
    public List<RoutineDto> copy(@PathVariable Long personId, @PathVariable Long routineId,
                                  @Valid @RequestBody CopyRoutineRequest request) {
        return routineService.copy(currentUser.access(), personId, routineId, request);
    }

    @DeleteMapping("/api/people/{personId}/routines/{routineId}")
    @RequiresPermission(personScoped = true)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long personId, @PathVariable Long routineId) {
        routineService.delete(currentUser.access(), personId, routineId);
    }
}
