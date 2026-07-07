package com.worktrac.backend.person;

public record PersonDto(Long id, String name, boolean isPrimary) {

    public static PersonDto from(Person person) {
        return new PersonDto(person.getId(), person.getName(), person.isPrimary());
    }
}
