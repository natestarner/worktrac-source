package com.worktrac.backend.personcategory;

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

@RestController
@RequestMapping("/api/people/{personId}/categories")
public class PersonCategoryController {

    private final PersonCategoryService personCategoryService;
    private final CurrentUser currentUser;

    public PersonCategoryController(PersonCategoryService personCategoryService, CurrentUser currentUser) {
        this.personCategoryService = personCategoryService;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<PersonCategoryDto> list(@PathVariable Long personId) {
        return personCategoryService.list(currentUser.accountId(), personId);
    }

    @GetMapping("/recommendations")
    public List<String> recommendations(@PathVariable Long personId) {
        return personCategoryService.recommendations(currentUser.accountId(), personId);
    }

    @PostMapping
    public PersonCategoryDto create(@PathVariable Long personId, @Valid @RequestBody PersonCategoryRequest request) {
        return personCategoryService.create(currentUser.accountId(), personId, request.name());
    }

    @PutMapping("/{categoryId}")
    public PersonCategoryDto rename(@PathVariable Long personId, @PathVariable Long categoryId,
                                     @Valid @RequestBody PersonCategoryRequest request) {
        return personCategoryService.rename(currentUser.accountId(), personId, categoryId, request.name());
    }

    @DeleteMapping("/{categoryId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long personId, @PathVariable Long categoryId) {
        personCategoryService.delete(currentUser.accountId(), personId, categoryId);
    }
}
