package com.worktrac.backend.tag;

import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.AccountRole;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.membership.SharedResourceMessages;
import com.worktrac.backend.exercise.PersonExerciseRepository;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.quota.QuotaService;
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
    private final QuotaService quotaService;
    private final PersonExerciseRepository personExerciseRepository;
    private final AccountMembershipRepository membershipRepository;

    public TagService(TagRepository tagRepository, AccountRepository accountRepository,
                       QuotaService quotaService, PersonExerciseRepository personExerciseRepository,
                       AccountMembershipRepository membershipRepository) {
        this.tagRepository = tagRepository;
        this.accountRepository = accountRepository;
        this.quotaService = quotaService;
        this.personExerciseRepository = personExerciseRepository;
        this.membershipRepository = membershipRepository;
    }

    @Transactional(readOnly = true)
    public List<TagDto> list(Long accountId) {
        return tagRepository.findByAccount_IdOrderByNameAsc(accountId).stream().map(TagDto::from).toList();
    }

    @Transactional
    public TagDto create(AccountAccess access, String name) {
        return TagDto.from(getOrCreate(access.accountId(), name, access.userId()));
    }

    @Transactional
    public TagDto rename(AccountAccess access, Long tagId, String name) {
        Long accountId = access.accountId();
        String trimmed = requireName(name);
        Tag tag = tagRepository.findByIdAndAccount_Id(tagId, accountId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that tag."));

        // The tag counterpart of ExerciseService.update's check, and the same warning applies: the
        // handler's annotation went from EDIT_ANY_SHARED_RESOURCE to EDIT_OWN_SHARED_RESOURCE, so
        // every member now reaches this method and only this line refuses them.
        //
        // Checked BEFORE the name-collision test below so a member probing for names cannot learn
        // which tags the household already has from a 409-vs-403 difference on a tag that is not
        // theirs to touch either way.
        if (!access.mayEditSharedResource(tag.getCreatedByUserId())) {
            throw new ForbiddenException("Only the person who added this tag, or the account owner, can rename it");
        }

        // The tag counterpart of ExerciseService.update's in-use check -- read that comment for the
        // full reasoning. A tag is applied to OTHER people's exercises, so renaming one relabels
        // whatever they filed under it. "Used" therefore means applied by somebody other than you,
        // and the owner stays exempt because they are the remedy the message points at.
        //
        // Checked BEFORE the name-collision test below, deliberately: a member who may not rename
        // this tag at all must not be able to learn which names the household already has from a
        // 409-about-collision arriving instead of a 409-about-usage.
        if (!access.has(Permission.EDIT_ANY_SHARED_RESOURCE)
                && personExerciseRepository.isTagAppliedByAnotherPerson(tagId, access.requireSelfPersonId())) {
            throw new ConflictException(SharedResourceMessages.inUse("tag",
                    membershipRepository.findOwnerPersonNames(accountId, AccountRole.OWNER)));
        }

        if (!tag.getName().equalsIgnoreCase(trimmed)
                && tagRepository.findByAccount_IdAndName(accountId, trimmed).isPresent()) {
            throw new ConflictException("A tag with that name already exists");
        }
        tag.setName(trimmed);
        return TagDto.from(tag);
    }

    // Deliberately still a bare accountId, and deliberately consults no creator stamp:
    // DELETE_SHARED_RESOURCE is owner-only, so the handler's annotation is the entire decision.
    // See AccountAccess.mayEditSharedResource for why edit and delete part company here.
    @Transactional
    public void delete(Long accountId, Long tagId) {
        Tag tag = tagRepository.findByIdAndAccount_Id(tagId, accountId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that tag."));
        tagRepository.delete(tag);
    }

    // Whether this account already has a tag by this name, matched exactly the way getOrCreate
    // matches. The importer asks so it can report which tags it is about to ADD to the household
    // vocabulary -- "5 tags applied" and "2 of them are new to your account" are different facts.
    @Transactional(readOnly = true)
    public java.util.Optional<Tag> find(Long accountId, String name) {
        if (name == null || name.trim().isEmpty()) {
            return java.util.Optional.empty();
        }
        return tagRepository.findByAccount_IdAndName(accountId, name.trim());
    }

    // Find an existing tag by name (case-insensitively, per DB collation) or create one. This
    // is what makes free-text tagging create-on-the-fly without spawning "chest"/"Chest" dupes.
    //
    // ⚠️ NOT just the create endpoint. PersonExerciseService reaches this from setTags (a member
    // tagging their own exercise) and from the importer, so it is the single point where a tag can
    // enter the household vocabulary and therefore the only place worth stamping.
    //
    // createdByUserId is stamped ONLY on the create branch. Finding an existing tag must return it
    // untouched: re-stamping would transfer authorship to whoever happened to type the name next,
    // and with it who may rename it.
    //
    // No permission check here either, for ExerciseService.add's reason -- MEMBER holds
    // CREATE_SHARED_RESOURCE unconditionally, and a 403 on this path would take down the durable
    // write that triggered it.
    @Transactional
    public Tag getOrCreate(Long accountId, String name, Long createdByUserId) {
        String trimmed = requireName(name);
        return tagRepository.findByAccount_IdAndName(accountId, trimmed)
                .orElseGet(() -> {
                    // Checked only on the CREATE branch: finding an existing tag must never be
                    // refused, or a household at its ceiling could no longer re-apply tags it
                    // already has.
                    quotaService.requireTagCapacity(accountId, tagRepository.countByAccount_Id(accountId));
                    return tagRepository.save(
                            new Tag(accountRepository.getReferenceById(accountId), trimmed, createdByUserId));
                });
    }

    private String requireName(String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("Tag name must not be blank");
        }
        return name.trim();
    }
}
