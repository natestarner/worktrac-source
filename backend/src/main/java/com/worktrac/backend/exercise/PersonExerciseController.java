package com.worktrac.backend.exercise;

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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// Per-person view of exercises: the Log picker list (favorites UNION noted UNION logged),
// favoriting, applying the household's shared tags, the standing per-person note, and the
// per-person setup-field overlay. All setup fields are per-person now; they live on the
// /{exerciseId}/custom-fields subpaths.
@RestController
@RequestMapping("/api/people/{personId}/exercises")
public class PersonExerciseController {

    private final PersonExerciseService personExerciseService;
    private final CurrentUser currentUser;

    public PersonExerciseController(PersonExerciseService personExerciseService, CurrentUser currentUser) {
        this.personExerciseService = personExerciseService;
        this.currentUser = currentUser;
    }

    @GetMapping
    @RequiresPermission(personScoped = true)
    public List<PersonExerciseDto> list(@PathVariable Long personId) {
        return personExerciseService.listForPerson(currentUser.access(), personId);
    }

    @PutMapping("/{exerciseId}/favorite")
    @RequiresPermission(personScoped = true)
    public PersonExerciseDto favorite(@PathVariable Long personId, @PathVariable Long exerciseId) {
        return personExerciseService.setFavorite(currentUser.access(), personId, exerciseId, true);
    }

    @DeleteMapping("/{exerciseId}/favorite")
    @RequiresPermission(personScoped = true)
    public PersonExerciseDto unfavorite(@PathVariable Long personId, @PathVariable Long exerciseId) {
        return personExerciseService.setFavorite(currentUser.access(), personId, exerciseId, false);
    }

    @PutMapping("/{exerciseId}/note")
    @RequiresPermission(personScoped = true)
    public PersonExerciseDto setNote(@PathVariable Long personId, @PathVariable Long exerciseId,
                                      @Valid @RequestBody PersonExerciseNoteRequest request) {
        return personExerciseService.setNote(currentUser.access(), personId, exerciseId, request.note());
    }

    @PutMapping("/{exerciseId}/tags")
    @RequiresPermission(personScoped = true)
    public PersonExerciseDto setTags(@PathVariable Long personId, @PathVariable Long exerciseId,
                                     @Valid @RequestBody ExerciseTagsRequest request) {
        return personExerciseService.setTags(currentUser.access(), personId, exerciseId, request.tagsOrEmpty());
    }

    @GetMapping("/{exerciseId}/custom-fields")
    @RequiresPermission(personScoped = true)
    public List<PersonExerciseFieldDto> listCustomFields(@PathVariable Long personId, @PathVariable Long exerciseId) {
        return personExerciseService.listCustomFields(currentUser.access(), personId, exerciseId);
    }

    @PostMapping("/{exerciseId}/custom-fields")
    @RequiresPermission(personScoped = true)
    public PersonExerciseFieldDto addCustomField(@PathVariable Long personId, @PathVariable Long exerciseId,
                                                  @Valid @RequestBody PersonExerciseFieldRequest request) {
        return personExerciseService.addCustomField(currentUser.access(), personId, exerciseId, request.name());
    }

    @PutMapping("/{exerciseId}/custom-fields/{fieldId}")
    @RequiresPermission(personScoped = true)
    public PersonExerciseFieldDto updateCustomField(@PathVariable Long personId, @PathVariable Long exerciseId,
                                                     @PathVariable Long fieldId,
                                                     @Valid @RequestBody PersonExerciseFieldRequest request) {
        return personExerciseService.updateCustomField(currentUser.access(), personId, exerciseId, fieldId,
                request.name(), request.value());
    }

    @DeleteMapping("/{exerciseId}/custom-fields/{fieldId}")
    @RequiresPermission(personScoped = true)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteCustomField(@PathVariable Long personId, @PathVariable Long exerciseId, @PathVariable Long fieldId) {
        personExerciseService.deleteCustomField(currentUser.access(), personId, exerciseId, fieldId);
    }
}
