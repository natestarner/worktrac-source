package com.worktrac.backend.personcategory;

import com.worktrac.backend.category.Category;
import com.worktrac.backend.category.CategoryRepository;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.exercise.PersonExercise;
import com.worktrac.backend.exercise.PersonExerciseRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class PersonCategoryService {

    private final PersonCategoryRepository personCategoryRepository;
    private final PersonExerciseRepository personExerciseRepository;
    private final CategoryRepository categoryRepository;
    private final PersonService personService;

    public PersonCategoryService(PersonCategoryRepository personCategoryRepository,
                                  PersonExerciseRepository personExerciseRepository,
                                  CategoryRepository categoryRepository,
                                  PersonService personService) {
        this.personCategoryRepository = personCategoryRepository;
        this.personExerciseRepository = personExerciseRepository;
        this.categoryRepository = categoryRepository;
        this.personService = personService;
    }

    @Transactional(readOnly = true)
    public List<PersonCategoryDto> list(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        return personCategoryRepository.findByPerson_IdOrderBySortOrderAscNameAsc(person.getId()).stream()
                .map(PersonCategoryDto::from)
                .toList();
    }

    // The seeded global category names, offered as one-tap starters -- minus any the person
    // already created. This is the only remaining role of the legacy global `categories` rows.
    @Transactional(readOnly = true)
    public List<String> recommendations(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        List<PersonCategory> existing = personCategoryRepository.findByPerson_IdOrderBySortOrderAscNameAsc(person.getId());
        List<String> taken = existing.stream().map(PersonCategory::getName).map(String::toLowerCase).toList();
        return categoryRepository.findVisibleToAccount(accountId).stream()
                .filter(Category::isGlobal)
                .map(Category::getName)
                .filter(name -> !taken.contains(name.toLowerCase()))
                .toList();
    }

    @Transactional
    public PersonCategoryDto create(Long accountId, Long personId, String name) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        String trimmed = name.trim();
        if (personCategoryRepository.existsByPerson_IdAndName(person.getId(), trimmed)) {
            throw new ConflictException("You already have a category named \"" + trimmed + "\"");
        }
        int nextOrder = personCategoryRepository.findByPerson_IdOrderBySortOrderAscNameAsc(person.getId()).size();
        PersonCategory category = personCategoryRepository.save(new PersonCategory(person, trimmed, nextOrder));
        return PersonCategoryDto.from(category);
    }

    @Transactional
    public PersonCategoryDto rename(Long accountId, Long personId, Long categoryId, String name) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        PersonCategory category = requireOwned(person, categoryId);
        String trimmed = name.trim();
        if (!category.getName().equalsIgnoreCase(trimmed)
                && personCategoryRepository.existsByPerson_IdAndName(person.getId(), trimmed)) {
            throw new ConflictException("You already have a category named \"" + trimmed + "\"");
        }
        category.setName(trimmed);
        return PersonCategoryDto.from(category);
    }

    // Deleting a category leaves its exercises in the picker, just uncategorized -- so clear
    // the reference on every person_exercise pointing at it before removing the row (the FK
    // would otherwise block the delete).
    @Transactional
    public void delete(Long accountId, Long personId, Long categoryId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        PersonCategory category = requireOwned(person, categoryId);
        for (PersonExercise pe : personExerciseRepository.findByCategory_Id(category.getId())) {
            pe.setCategory(null);
        }
        personCategoryRepository.delete(category);
    }

    private PersonCategory requireOwned(Person person, Long categoryId) {
        return personCategoryRepository.findByIdAndPerson_Id(categoryId, person.getId())
                .orElseThrow(() -> new NotFoundException("No such category"));
    }
}
