package com.worktrac.backend.personcategory;

public record PersonCategoryDto(Long id, String name, int sortOrder) {

    public static PersonCategoryDto from(PersonCategory category) {
        return new PersonCategoryDto(category.getId(), category.getName(), category.getSortOrder());
    }
}
