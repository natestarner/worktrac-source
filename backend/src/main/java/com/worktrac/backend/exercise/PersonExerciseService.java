package com.worktrac.backend.exercise;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.quota.QuotaService;
import com.worktrac.backend.tag.Tag;
import com.worktrac.backend.tag.TagService;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

// Everything that is "this person's relationship to an exercise": their Log-picker list
// (favorites UNION logged), favoriting, filing into their own categories, and the custom
// setup-field overlay. None of it mutates the shared Exercise row.
@Service
public class PersonExerciseService {

    private final PersonExerciseRepository personExerciseRepository;
    private final PersonExerciseFieldRepository personExerciseFieldRepository;
    private final TagService tagService;
    private final ExerciseRepository exerciseRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final PersonService personService;
    private final QuotaService quotaService;

    public PersonExerciseService(PersonExerciseRepository personExerciseRepository,
                                  PersonExerciseFieldRepository personExerciseFieldRepository,
                                  TagService tagService,
                                  ExerciseRepository exerciseRepository,
                                  WorkoutSetRepository workoutSetRepository,
                                  PersonService personService,
                                  QuotaService quotaService) {
        this.personExerciseRepository = personExerciseRepository;
        this.personExerciseFieldRepository = personExerciseFieldRepository;
        this.tagService = tagService;
        this.exerciseRepository = exerciseRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.personService = personService;
        this.quotaService = quotaService;
    }

    // The person's Log picker: every exercise they've favorited, logged a set for, left a
    // standing note on, tagged, or added a custom setup field to -- carrying their
    // personalization. Anything else in the catalog is reachable only via search. Each of
    // note/tags/customFields has to count here the same way favoriting does -- otherwise that
    // personalization is set on an exercise the person hasn't favorited/logged yet, and it
    // becomes unreachable through the picker afterward (personExercises.find() would miss it
    // and fall back to the personalization-less catalog DTO), making it effectively invisible
    // right after saving it. See PersonExercise's class comment for the same invariant.
    @Transactional(readOnly = true)
    public List<PersonExerciseDto> listForPerson(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);

        Map<Long, PersonExercise> byExerciseId = new HashMap<>();
        Set<Long> pickerIds = new HashSet<>();
        for (PersonExercise pe : personExerciseRepository.findByPerson_Id(person.getId())) {
            Long exId = pe.getExercise().getId();
            byExerciseId.put(exId, pe);
            boolean personalized = pe.isFavorite()
                    || (pe.getNote() != null && !pe.getNote().isBlank())
                    || !pe.getTags().isEmpty()
                    || !pe.getCustomFields().isEmpty();
            if (personalized) {
                pickerIds.add(exId);
            }
        }
        pickerIds.addAll(workoutSetRepository.findDistinctExerciseIdsByPerson(person.getId()));
        if (pickerIds.isEmpty()) {
            return List.of();
        }

        return exerciseRepository.findAllById(pickerIds).stream()
                .filter(ex -> !ex.isDeleted())
                .filter(ex -> ex.isGlobal() || ex.getAccount().getId().equals(accountId))
                .sorted(Comparator.comparing(Exercise::getName, String.CASE_INSENSITIVE_ORDER))
                .map(ex -> PersonExerciseDto.of(ex, byExerciseId.get(ex.getId())))
                .toList();
    }

    @Transactional
    public PersonExerciseDto setFavorite(Long accountId, Long personId, Long exerciseId, boolean favorite) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        PersonExercise pe = getOrCreate(person, exercise);
        pe.setFavorite(favorite);
        return PersonExerciseDto.of(exercise, pe);
    }

    // Free-text tagging: each name is upserted into the account's shared vocabulary, then the
    // person's tag set for this exercise is replaced with exactly those tags. An empty list
    // clears them.
    @Transactional
    public PersonExerciseDto setTags(Long accountId, Long personId, Long exerciseId, List<String> tagNames) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        Set<Tag> resolved = new HashSet<>();
        if (tagNames != null) {
            for (String name : tagNames) {
                if (name != null && !name.trim().isEmpty()) {
                    resolved.add(tagService.getOrCreate(accountId, name));
                }
            }
        }
        PersonExercise pe = getOrCreate(person, exercise);
        pe.getTags().clear();
        pe.getTags().addAll(resolved);
        return PersonExerciseDto.of(exercise, pe);
    }

    // The standing per-person note: a blank/whitespace-only value clears it back to null
    // rather than storing an empty string.
    @Transactional
    public PersonExerciseDto setNote(Long accountId, Long personId, Long exerciseId, String note) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        PersonExercise pe = getOrCreate(person, exercise);
        String trimmed = note == null ? "" : note.trim();
        pe.setNote(trimmed.isEmpty() ? null : trimmed);
        return PersonExerciseDto.of(exercise, pe);
    }

    // Additive personalization, for the CSV/Excel importer (called with an already-resolved,
    // already-owned person/exercise).
    //
    // ⚠️ This exists BECAUSE setTags above replaces the whole tag set. An import must never remove
    // a tag, a note or a favorite the person already has: the file may be months old, and the only
    // thing it can honestly claim is what it does contain, never the absence of anything. So:
    // tags are unioned, a note is written only where there is none, and favorite is only ever
    // turned on. Anything already there wins, and the preview reports what was left alone.
    //
    // Returns what was actually applied, so the import summary can distinguish "we set your note"
    // from "you already had one".
    @Transactional
    public PersonalizationApplied applyImportedPersonalization(Long accountId, Person person, Exercise exercise,
                                                                String note, boolean favorite, List<String> tagNames) {
        PersonExercise pe = getOrCreate(person, exercise);

        boolean noteApplied = false;
        boolean noteSkipped = false;
        if (note != null && !note.isBlank()) {
            if (pe.getNote() == null || pe.getNote().isBlank()) {
                pe.setNote(note.trim());
                noteApplied = true;
            } else {
                noteSkipped = true;
            }
        }

        boolean favoriteApplied = false;
        if (favorite && !pe.isFavorite()) {
            pe.setFavorite(true);
            favoriteApplied = true;
        }

        int tagsAdded = 0;
        List<String> newTagNames = new ArrayList<>();
        if (tagNames != null) {
            Set<String> existing = pe.getTags().stream()
                    .map(t -> t.getName().toLowerCase(java.util.Locale.ROOT))
                    .collect(Collectors.toSet());
            for (String name : tagNames) {
                if (name == null || name.isBlank() || existing.contains(name.trim().toLowerCase(java.util.Locale.ROOT))) {
                    continue;
                }
                boolean isNewToAccount = tagService.find(accountId, name.trim()).isEmpty();
                Tag tag = tagService.getOrCreate(accountId, name.trim());
                pe.getTags().add(tag);
                existing.add(tag.getName().toLowerCase(java.util.Locale.ROOT));
                tagsAdded++;
                if (isNewToAccount) {
                    newTagNames.add(tag.getName());
                }
            }
        }

        return new PersonalizationApplied(noteApplied, noteSkipped, favoriteApplied, tagsAdded, newTagNames);
    }

    public record PersonalizationApplied(boolean noteApplied, boolean noteSkipped, boolean favoriteApplied,
                                          int tagsAdded, List<String> newTagNames) {
    }

    // Auto-favorite hook for when an exercise is added to a routine (called from
    // RoutineService with an already-resolved, already-owned person/exercise).
    @Transactional
    public void ensureFavorite(Person person, Exercise exercise) {
        PersonExercise pe = getOrCreate(person, exercise);
        if (!pe.isFavorite()) {
            pe.setFavorite(true);
        }
    }

    @Transactional(readOnly = true)
    public List<PersonExerciseFieldDto> listCustomFields(Long accountId, Long personId, Long exerciseId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        requireVisibleExercise(accountId, exerciseId);
        return personExerciseRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId)
                .map(pe -> personExerciseFieldRepository.findByPersonExercise_IdOrderBySortOrderAsc(pe.getId()).stream()
                        .map(PersonExerciseFieldDto::from)
                        .toList())
                .orElse(List.of());
    }

    @Transactional
    public PersonExerciseFieldDto addCustomField(Long accountId, Long personId, Long exerciseId, String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("Field name must not be blank");
        }
        Person person = personService.requireOwnedPerson(personId, accountId);
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        PersonExercise pe = getOrCreate(person, exercise);
        quotaService.requireCustomFieldCapacity(accountId,
                personExerciseFieldRepository.countByPersonExercise_Id(pe.getId()));
        int nextOrder = personExerciseFieldRepository.findByPersonExercise_IdOrderBySortOrderAsc(pe.getId()).size();
        PersonExerciseField field = personExerciseFieldRepository.save(new PersonExerciseField(pe, name.trim(), nextOrder));
        return PersonExerciseFieldDto.from(field);
    }

    @Transactional
    public PersonExerciseFieldDto updateCustomField(Long accountId, Long personId, Long exerciseId, Long fieldId,
                                                     String name, String value) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        requireVisibleExercise(accountId, exerciseId);
        PersonExerciseField field = requireField(person, exerciseId, fieldId);
        if (name != null && !name.trim().isEmpty()) {
            field.setName(name.trim());
        }
        if (value != null) {
            field.setValue(value.trim());
        }
        return PersonExerciseFieldDto.from(field);
    }

    @Transactional
    public void deleteCustomField(Long accountId, Long personId, Long exerciseId, Long fieldId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        requireVisibleExercise(accountId, exerciseId);
        personExerciseFieldRepository.delete(requireField(person, exerciseId, fieldId));
    }

    private PersonExerciseField requireField(Person person, Long exerciseId, Long fieldId) {
        PersonExercise pe = personExerciseRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that custom field."));
        return personExerciseFieldRepository.findByIdAndPersonExercise_Id(fieldId, pe.getId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that custom field."));
    }

    private PersonExercise getOrCreate(Person person, Exercise exercise) {
        return personExerciseRepository.findByPerson_IdAndExercise_Id(person.getId(), exercise.getId())
                .orElseGet(() -> personExerciseRepository.save(new PersonExercise(person, exercise)));
    }

    private Exercise requireVisibleExercise(Long accountId, Long exerciseId) {
        Exercise exercise = exerciseRepository.findById(exerciseId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that exercise."));
        boolean visible = exercise.isGlobal() || exercise.getAccount().getId().equals(accountId);
        if (!visible) {
            throw new NotFoundException("We couldn't find that exercise.");
        }
        return exercise;
    }
}
