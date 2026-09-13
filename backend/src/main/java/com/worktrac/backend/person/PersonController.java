package com.worktrac.backend.person;

import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/people")
public class PersonController {

    private final PersonService personService;
    private final CurrentUser currentUser;

    public PersonController(PersonService personService, CurrentUser currentUser) {
        this.personService = personService;
        this.currentUser = currentUser;
    }

    // Any member may ask who is in their household; the service decides who they get to SEE.
    @GetMapping
    @RequiresPermission(anyMember = true)
    public List<PersonDto> list() {
        return personService.list(currentUser.access());
    }

    @PostMapping
    @RequiresPermission(Permission.MANAGE_PEOPLE)
    public PersonDto add(@Valid @RequestBody AddPersonRequest request) {
        return personService.add(currentUser.access(), request.name());
    }

    // Person-scoped, NOT MANAGE_PEOPLE: renaming yourself is a member's own business. Renaming
    // someone else needs WRITE_OTHER_PEOPLE, and requireWritablePerson enforces exactly that
    // distinction without this handler needing to know which case it is.
    @PatchMapping("/{personId}")
    @RequiresPermission(personScoped = true)
    public PersonDto rename(@PathVariable Long personId, @Valid @RequestBody AddPersonRequest request) {
        return personService.rename(currentUser.access(), personId, request.name());
    }

    // Household-wide settings are configured for every person from one screen, so this is keyed on
    // an explicit personId rather than the active person. Same person-scoped reasoning as rename:
    // the rest timer is a training preference, and a member turning their own off mid-workout
    // must not have to ask the owner.
    @PutMapping("/{personId}/rest-timer-preference")
    @RequiresPermission(personScoped = true)
    public PersonDto setRestTimerPreference(@PathVariable Long personId,
                                            @Valid @RequestBody RestTimerPreferenceRequest request) {
        return personService.setRestTimerEnabled(currentUser.access(), personId, request.enabled());
    }

    // MANAGE_PEOPLE rather than person-scoped, deliberately: this deletes that person's entire
    // training history, so it must not be reachable by a member acting on themselves.
    @DeleteMapping("/{personId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @RequiresPermission(Permission.MANAGE_PEOPLE)
    public void remove(@PathVariable Long personId) {
        personService.remove(currentUser.access(), personId);
    }
}
