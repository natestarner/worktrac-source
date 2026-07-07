package com.worktrac.backend.routine;

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
    public List<RoutineDto> list(@PathVariable Long personId) {
        return routineService.list(currentUser.accountId(), personId);
    }

    @PostMapping("/api/people/{personId}/routines")
    public RoutineDto create(@PathVariable Long personId, @Valid @RequestBody RoutineRequest request) {
        return routineService.create(currentUser.accountId(), personId, request);
    }

    @PutMapping("/api/people/{personId}/routines/{routineId}")
    public RoutineDto update(@PathVariable Long personId, @PathVariable Long routineId,
                              @Valid @RequestBody RoutineRequest request) {
        return routineService.update(currentUser.accountId(), personId, routineId, request);
    }

    @DeleteMapping("/api/people/{personId}/routines/{routineId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long personId, @PathVariable Long routineId) {
        routineService.delete(currentUser.accountId(), personId, routineId);
    }
}
