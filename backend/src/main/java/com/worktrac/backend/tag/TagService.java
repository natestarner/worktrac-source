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
    public List<TagDto> list(AccountAccess access) {
        return tagRepository.findByAccount_IdOrderByNameAsc(access.accountId()).stream()
                .map(tag -> TagDto.from(tag, canDelete(access, tag)))
                .toList();
    }

    @Transactional
    public TagDto create(AccountAccess access, String name) {
        Tag tag = getOrCreate(access.accountId(), name, access.userId());
        return TagDto.from(tag, canDelete(access, tag));
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
        return TagDto.from(tag, canDelete(access, tag));
    }

    // A member may delete a tag they created once nobody else depends on it -- the delete
    // counterpart of the rename rule above, and deliberately the same two checks in the same
    // order for the same probing reason: ownership before in-use, so a tag that isn't theirs
    // can't be told apart from one that is theirs-but-used by which status code comes back.
    //
    // The owner's DELETE_SHARED_RESOURCE remains exactly what it always was: no ownership check,
    // no in-use check. Exercises have no member-facing delete at all -- ExerciseController's
    // DELETE stays DELETE_SHARED_RESOURCE only, so this method's shape is tag-specific, not a
    // template ExerciseService is expected to grow into.
    @Transactional
    public void delete(AccountAccess access, Long tagId) {
        Long accountId = access.accountId();
        Tag tag = tagRepository.findByIdAndAccount_Id(tagId, accountId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that tag."));

        if (!access.mayDeleteSharedResource(tag.getCreatedByUserId())) {
            throw new ForbiddenException("Only the person who added this tag, or the account owner, can delete it");
        }

        // Only the member's narrower DELETE_OWN grant is usage-aware -- see
        // AccountAccess.mayDeleteSharedResource. "Used" means applied by somebody OTHER than you,
        // same polarity as rename: deleting your own tag off your own exercises is yours to do.
        if (!access.has(Permission.DELETE_SHARED_RESOURCE)
                && personExerciseRepository.isTagAppliedByAnotherPerson(tagId, access.requireSelfPersonId())) {
            throw new ConflictException(SharedResourceMessages.inUse("tag",
                    membershipRepository.findOwnerPersonNames(accountId, AccountRole.OWNER)));
        }

        tagRepository.delete(tag);
    }

    // Whether ACCESS may delete THIS tag right now -- the same question the delete method above
    // answers, computed here too so the client can decide whether to offer the control at all
    // (TagDto.deletable) instead of discovering the refusal by clicking it
    // (member-access.md's "a control the server will refuse must not be offered").
    private boolean canDelete(AccountAccess access, Tag tag) {
        if (!access.mayDeleteSharedResource(tag.getCreatedByUserId())) {
            return false;
        }
        if (access.has(Permission.DELETE_SHARED_RESOURCE)) {
            return true;
        }
        return !personExerciseRepository.isTagAppliedByAnotherPerson(tag.getId(), access.requireSelfPersonId());
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
