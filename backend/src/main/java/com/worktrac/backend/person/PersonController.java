package com.worktrac.backend.person;

import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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

    @GetMapping
    public List<PersonDto> list() {
        return personService.list(currentUser.accountId());
    }

    @PostMapping
    public PersonDto add(@Valid @RequestBody AddPersonRequest request) {
        return personService.add(currentUser.accountId(), request.name());
    }

    @DeleteMapping("/{personId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@PathVariable Long personId) {
        personService.remove(currentUser.accountId(), personId);
    }
}
