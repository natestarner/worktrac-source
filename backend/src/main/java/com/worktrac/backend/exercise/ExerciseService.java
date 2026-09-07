package com.worktrac.backend.exercise;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.quota.QuotaService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
public class ExerciseService {

    private final ExerciseRepository exerciseRepository;
    private final AccountRepository accountRepository;
    private final QuotaService quotaService;

    public ExerciseService(ExerciseRepository exerciseRepository, AccountRepository accountRepository,
                            QuotaService quotaService) {
        this.exerciseRepository = exerciseRepository;
        this.accountRepository = accountRepository;
        this.quotaService = quotaService;
    }

    // The full catalog visible to this account, used for search. Grouping/favoriting is now
    // per-person (see PersonExerciseService); this is just the searchable pool.
    @Transactional(readOnly = true)
    public List<ExerciseDto> list(Long accountId) {
        return exerciseRepository.findVisibleToAccount(accountId).stream()
                .map(ExerciseDto::from)
                .toList();
    }

    // ⚠️ NO PERMISSION CHECK LIVES IN HERE, and that is structural rather than an oversight.
    // MEMBER holds CREATE_SHARED_RESOURCE unconditionally, so the handler's annotation is the whole
    // gate and every login that reaches this method is allowed to be here. That matters because
    // this is a DURABLE write: shouldRetryWrite treats a definitive 4xx as terminal, so any 403
    // raised here would discard the create for good, along with every set already queued behind
    // its temp exercise id. See the quota comment further down, which is the same argument.
    @Transactional
    public ExerciseDto add(AccountAccess access, ExerciseRequest request) {
        Long accountId = access.accountId();
        // Idempotent create: a retried or offline-replayed create carrying the same client key
        // returns the already-committed exercise instead of inserting a second row. Blank/absent key
        // => no dedup (mirrors WorkoutSetService.findDuplicate). A filtered unique index (V43)
        // backstops the concurrent double-submit the pre-check can't see.
        String clientKey = request.idempotencyKey();
        boolean deduped = clientKey != null && !clientKey.isBlank();
        if (deduped) {
            Optional<Exercise> existing = exerciseRepository.findByClientKeyAndAccount_Id(clientKey, accountId);
            if (existing.isPresent()) {
                return ExerciseDto.from(existing.get());
            }
        }
        // IllegalArgumentException is the app's existing route to an honest 400
        // (GlobalExceptionHandler#handleIllegalArgument) -- no new exception type needed. Validated
        // before the duplicate lookup below, which needs a known-good tracking type to match on.
        String trackingType = request.trackingTypeOrDefault();
        if (!Exercise.isValidTrackingType(trackingType)) {
            throw new IllegalArgumentException("Unknown tracking type: " + trackingType);
        }
        String name = request.name().trim();

        // Same name AND same measure already visible to this account -> return that exercise rather
        // than inserting a second one. The client (utils/exerciseDuplicates.js) applies the same
        // rule before it ever dispatches; this catches what its cache cannot see -- two devices
        // creating the same exercise while offline, or a create dispatched against a catalog
        // snapshot that predates someone else's.
        //
        // Deliberately NOT a 409, and deliberately no unique index backing it. shouldRetryWrite
        // treats a definitive 4xx as terminal, so a rejected durable create is DISCARDED for good --
        // along with every set already queued behind it against a temp exercise id that would then
        // never resolve. Returning the existing row instead lets that temp id map onto it and those
        // sets land. See .claude/rules/workout-data-model.md.
        //
        // Known gap, accepted: this does not apply the client's "(Time)"/"(Reps)" suffix, so two
        // devices creating the same name offline with DIFFERENT measures still converge to two rows
        // sharing a name. It needs a genuine cross-device offline race, it is no worse than today,
        // and the alternative -- the server silently renaming what the client asked for -- is worse
        // than the gap.
        List<Exercise> sameNameAndMeasure =
                exerciseRepository.findVisibleByNameAndTrackingType(accountId, name, trackingType);
        if (!sameNameAndMeasure.isEmpty()) {
            return ExerciseDto.from(sameNameAndMeasure.get(0));
        }

        // Deliberately here, AFTER both dedup branches above. A create that resolves to an
        // existing row adds nothing and must never be refused -- and this is a DURABLE write, so
        // a 403 discards it permanently along with every set queued behind its temp id. Only a
        // create that would genuinely add a row consults the ceiling.
        quotaService.requireExerciseCapacity(accountId,
                exerciseRepository.countByAccount_IdAndDeletedFalse(accountId));

        Account account = accountRepository.getReferenceById(accountId);
        // Stamped only on the branch that genuinely inserts. Both dedup branches above return
        // somebody else's existing row untouched -- re-attributing it to whoever happened to
        // replay a create would quietly transfer authorship, and with it who may rename it.
        Exercise exercise = new Exercise(account, name, deduped ? clientKey : null, trackingType,
                access.userId());
        return ExerciseDto.from(exerciseRepository.save(exercise));
    }

    // Editing is only for an account's own exercises. Preloaded (global) exercises are shared
    // and immutable in the favorites model -- to customise one you favorite it and add your own
    // setup fields via the per-person overlay, or add your own exercise. We therefore no
    // longer fork-on-edit; a global edit attempt is rejected outright.
    @Transactional
    public ExerciseDto update(AccountAccess access, Long exerciseId, ExerciseRequest request) {
        Exercise exercise = requireVisibleExercise(access.accountId(), exerciseId);
        if (exercise.isGlobal()) {
            throw new ForbiddenException("Preloaded exercises can't be edited -- favorite it, or add your own");
        }

        // ⚠️ THIS IS THE ONLY THING STOPPING A MEMBER RENAMING THE WHOLE HOUSEHOLD'S CATALOG.
        //
        // The handler's annotation was EDIT_ANY_SHARED_RESOURCE (owner-only) and is now
        // EDIT_OWN_SHARED_RESOURCE, which every member holds -- so the interceptor lets every
        // member through to here on purpose, and this line is what refuses. HandlerPermissionCoverageTest
        // asserts that an annotation is PRESENT, never which one, so it cannot catch this being
        // dropped; MemberPermissionsTest is what pins it.
        //
        // 403, not 404, per the guard asymmetry: the exercise is genuinely visible to them -- it is
        // in the shared catalog they search every day -- so pretending it does not exist is a lie
        // the picker contradicts on the same screen.
        if (!access.mayEditSharedResource(exercise.getCreatedByUserId())) {
            throw new ForbiddenException("Only the person who added this exercise, or the account owner, can rename it");
        }

        exercise.setName(request.name().trim());
        return ExerciseDto.from(exercise);
    }

    // Deleting is only for an account's own exercises. Removing a preloaded exercise from your
    // picker is done by unfavoriting it, not by deleting the shared row.
    //
    // Deliberately still takes a bare accountId, and deliberately consults no creator stamp:
    // DELETE_SHARED_RESOURCE is owner-only, so the handler's annotation is the entire decision and
    // there is nothing here for an AccountAccess to answer. A shared row that other people's
    // history already points at is not its creator's alone to remove -- see
    // AccountAccess.mayEditSharedResource for why edit and delete part company here.
    @Transactional
    public void remove(Long accountId, Long exerciseId) {
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        if (exercise.isGlobal()) {
            throw new ForbiddenException("Preloaded exercises can't be deleted -- unfavorite it to remove it from your picker");
        }
        exercise.setDeleted(true);
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
