package com.worktrac.backend.exercise;

import com.worktrac.backend.security.CurrentUser;
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

// Per-person view of exercises: the Log picker list (favorites UNION logged), favoriting,
// category filing, and the custom setup-field overlay. Shares the /api/people/{personId}/
// exercises namespace with SetupValueController (base setup fields), which lives on the
// /{exerciseId}/setup-* subpaths.
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
    public List<PersonExerciseDto> list(@PathVariable Long personId) {
        return personExerciseService.listForPerson(currentUser.accountId(), personId);
    }

    @PutMapping("/{exerciseId}/favorite")
    public PersonExerciseDto favorite(@PathVariable Long personId, @PathVariable Long exerciseId) {
        return personExerciseService.setFavorite(currentUser.accountId(), personId, exerciseId, true);
    }

    @DeleteMapping("/{exerciseId}/favorite")
    public PersonExerciseDto unfavorite(@PathVariable Long personId, @PathVariable Long exerciseId) {
        return personExerciseService.setFavorite(currentUser.accountId(), personId, exerciseId, false);
    }

    @PutMapping("/{exerciseId}/category")
    public PersonExerciseDto setCategory(@PathVariable Long personId, @PathVariable Long exerciseId,
                                          @RequestBody ExerciseCategoryRequest request) {
        return personExerciseService.setCategory(currentUser.accountId(), personId, exerciseId, request.personCategoryId());
    }

    @GetMapping("/{exerciseId}/custom-fields")
    public List<PersonExerciseFieldDto> listCustomFields(@PathVariable Long personId, @PathVariable Long exerciseId) {
        return personExerciseService.listCustomFields(currentUser.accountId(), personId, exerciseId);
    }

    @PostMapping("/{exerciseId}/custom-fields")
    public PersonExerciseFieldDto addCustomField(@PathVariable Long personId, @PathVariable Long exerciseId,
                                                  @RequestBody PersonExerciseFieldRequest request) {
        return personExerciseService.addCustomField(currentUser.accountId(), personId, exerciseId, request.name());
    }

    @PutMapping("/{exerciseId}/custom-fields/{fieldId}")
    public PersonExerciseFieldDto updateCustomField(@PathVariable Long personId, @PathVariable Long exerciseId,
                                                     @PathVariable Long fieldId,
                                                     @RequestBody PersonExerciseFieldRequest request) {
        return personExerciseService.updateCustomField(currentUser.accountId(), personId, exerciseId, fieldId,
                request.name(), request.value());
    }

    @DeleteMapping("/{exerciseId}/custom-fields/{fieldId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteCustomField(@PathVariable Long personId, @PathVariable Long exerciseId, @PathVariable Long fieldId) {
        personExerciseService.deleteCustomField(currentUser.accountId(), personId, exerciseId, fieldId);
    }
}
