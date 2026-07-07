package com.worktrac.backend.setupvalue;

import com.worktrac.backend.security.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/people/{personId}/exercises/{exerciseId}")
public class SetupValueController {

    private final SetupValueService setupValueService;
    private final CurrentUser currentUser;

    public SetupValueController(SetupValueService setupValueService, CurrentUser currentUser) {
        this.setupValueService = setupValueService;
        this.currentUser = currentUser;
    }

    @GetMapping("/setup-values")
    public List<SetupValueDto> list(@PathVariable Long personId, @PathVariable Long exerciseId) {
        return setupValueService.list(currentUser.accountId(), personId, exerciseId);
    }

    @PutMapping("/setup-fields/{fieldId}/value")
    public SetupValueDto upsert(@PathVariable Long personId, @PathVariable Long exerciseId,
                                 @PathVariable Long fieldId, @RequestBody SetupValueRequest request) {
        return setupValueService.upsert(currentUser.accountId(), personId, exerciseId, fieldId, request.value());
    }
}
