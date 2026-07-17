package com.worktrac.backend.tag;

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

// The household's shared tag vocabulary. Everyone in the account sees the same tags; these
// endpoints power tag autocomplete and the Tags manager in Settings. Assigning tags to a
// person's exercise lives on PersonExerciseController (PUT .../exercises/{id}/tags).
@RestController
@RequestMapping("/api/tags")
public class TagController {

    private final TagService tagService;
    private final CurrentUser currentUser;

    public TagController(TagService tagService, CurrentUser currentUser) {
        this.tagService = tagService;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<TagDto> list() {
        return tagService.list(currentUser.accountId());
    }

    @PostMapping
    public TagDto create(@Valid @RequestBody TagRequest request) {
        return tagService.create(currentUser.accountId(), request.name());
    }

    @PutMapping("/{tagId}")
    public TagDto rename(@PathVariable Long tagId, @Valid @RequestBody TagRequest request) {
        return tagService.rename(currentUser.accountId(), tagId, request.name());
    }

    @DeleteMapping("/{tagId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long tagId) {
        tagService.delete(currentUser.accountId(), tagId);
    }
}
