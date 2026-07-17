package com.worktrac.backend.tag;

import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.worktrac.backend.account.AccountRepository;

import java.util.List;

// The account's shared tag vocabulary: list (for autocomplete + the Settings manager), create,
// rename, delete. Tags are free-text and created on the fly -- getOrCreate is also used by
// PersonExerciseService.setTags as exercises get tagged. Names are unique per account (the DB
// collation makes that de-dup case-insensitive).
@Service
public class TagService {

    private final TagRepository tagRepository;
    private final AccountRepository accountRepository;

    public TagService(TagRepository tagRepository, AccountRepository accountRepository) {
        this.tagRepository = tagRepository;
        this.accountRepository = accountRepository;
    }

    @Transactional(readOnly = true)
    public List<TagDto> list(Long accountId) {
        return tagRepository.findByAccount_IdOrderByNameAsc(accountId).stream().map(TagDto::from).toList();
    }

    @Transactional
    public TagDto create(Long accountId, String name) {
        return TagDto.from(getOrCreate(accountId, name));
    }

    @Transactional
    public TagDto rename(Long accountId, Long tagId, String name) {
        String trimmed = requireName(name);
        Tag tag = tagRepository.findByIdAndAccount_Id(tagId, accountId)
                .orElseThrow(() -> new NotFoundException("No such tag"));
        if (!tag.getName().equalsIgnoreCase(trimmed)
                && tagRepository.findByAccount_IdAndName(accountId, trimmed).isPresent()) {
            throw new ConflictException("A tag with that name already exists");
        }
        tag.setName(trimmed);
        return TagDto.from(tag);
    }

    @Transactional
    public void delete(Long accountId, Long tagId) {
        Tag tag = tagRepository.findByIdAndAccount_Id(tagId, accountId)
                .orElseThrow(() -> new NotFoundException("No such tag"));
        tagRepository.delete(tag);
    }

    // Find an existing tag by name (case-insensitively, per DB collation) or create one. This
    // is what makes free-text tagging create-on-the-fly without spawning "chest"/"Chest" dupes.
    @Transactional
    public Tag getOrCreate(Long accountId, String name) {
        String trimmed = requireName(name);
        return tagRepository.findByAccount_IdAndName(accountId, trimmed)
                .orElseGet(() -> tagRepository.save(new Tag(accountRepository.getReferenceById(accountId), trimmed)));
    }

    private String requireName(String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("Tag name must not be blank");
        }
        return name.trim();
    }
}
