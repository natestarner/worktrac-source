package com.worktrac.backend.tag;

public record TagDto(Long id, String name) {

    public static TagDto from(Tag tag) {
        return new TagDto(tag.getId(), tag.getName());
    }
}
