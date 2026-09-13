package com.worktrac.backend.tag;

// `deletable` is computed per-request, for the CURRENT login -- not a property of the tag itself.
// It answers "would DELETE /api/tags/{id} succeed for me, right now", the same question
// TagService.delete's own checks answer, so the client never has to re-derive authorship + in-use
// logic from raw ids to decide whether to offer the control (member-access.md's "a control the
// server will refuse must not be offered"). An owner's is always true; a member's reflects both
// TagService.canDelete checks (theirs to remove, and nobody else uses it yet).
public record TagDto(Long id, String name, boolean deletable) {

    public static TagDto from(Tag tag, boolean deletable) {
        return new TagDto(tag.getId(), tag.getName(), deletable);
    }

    // For a context with no AccountAccess to ask -- PersonExerciseDto lists which of the
    // household's tags are applied to ONE exercise, a different question from "may I delete this
    // tag from the vocabulary" entirely, and that screen never reads `deletable`. `false` is a
    // safe placeholder rather than a real answer: nothing offers a delete control from a value
    // built this way, so an accidentally-permissive default here could never be acted on.
    public static TagDto from(Tag tag) {
        return new TagDto(tag.getId(), tag.getName(), false);
    }
}
