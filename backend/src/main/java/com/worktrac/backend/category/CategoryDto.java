package com.worktrac.backend.category;

public record CategoryDto(Long id, String name, boolean isGlobal) {

    public static CategoryDto from(Category category) {
        return new CategoryDto(category.getId(), category.getName(), category.isGlobal());
    }
}
