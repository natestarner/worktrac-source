package com.worktrac.backend.exercise;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.category.Category;
import com.worktrac.backend.category.CategoryRepository;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ExerciseService {

    private final ExerciseRepository exerciseRepository;
    private final CategoryRepository categoryRepository;
    private final AccountRepository accountRepository;

    public ExerciseService(ExerciseRepository exerciseRepository, CategoryRepository categoryRepository,
                            AccountRepository accountRepository) {
        this.exerciseRepository = exerciseRepository;
        this.categoryRepository = categoryRepository;
        this.accountRepository = accountRepository;
    }

    // The full catalog visible to this account, used for search. Grouping/favoriting is now
    // per-person (see PersonExerciseService); this is just the searchable pool.
    @Transactional(readOnly = true)
    public List<ExerciseDto> list(Long accountId) {
        return exerciseRepository.findVisibleToAccount(accountId).stream()
                .map(ExerciseDto::from)
                .toList();
    }

    @Transactional
    public ExerciseDto add(Long accountId, ExerciseRequest request) {
        Account account = accountRepository.getReferenceById(accountId);
        Category category = request.categoryId() == null ? null : requireVisibleCategory(accountId, request.categoryId());

        Exercise exercise = new Exercise(account, category, request.name().trim());
        return ExerciseDto.from(exerciseRepository.save(exercise));
    }

    // Editing is only for an account's own exercises. Preloaded (global) exercises are shared
    // and immutable in the favorites model -- to customise one you favorite it and add your own
    // setup fields via the per-person overlay, or add your own exercise. We therefore no
    // longer fork-on-edit; a global edit attempt is rejected outright.
    @Transactional
    public ExerciseDto update(Long accountId, Long exerciseId, ExerciseRequest request) {
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        if (exercise.isGlobal()) {
            throw new ForbiddenException("Preloaded exercises can't be edited -- favorite it, or add your own");
        }
        Category category = request.categoryId() == null ? null : requireVisibleCategory(accountId, request.categoryId());

        exercise.setName(request.name().trim());
        exercise.setCategory(category);
        return ExerciseDto.from(exercise);
    }

    // Deleting is only for an account's own exercises. Removing a preloaded exercise from your
    // picker is done by unfavoriting it, not by deleting the shared row.
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
                .orElseThrow(() -> new NotFoundException("No such exercise"));
        boolean visible = exercise.isGlobal() || exercise.getAccount().getId().equals(accountId);
        if (!visible) {
            throw new NotFoundException("No such exercise");
        }
        return exercise;
    }

    private Category requireVisibleCategory(Long accountId, Long categoryId) {
        Category category = categoryRepository.findById(categoryId)
                .orElseThrow(() -> new NotFoundException("No such category"));
        boolean visible = category.isGlobal() || category.getAccount().getId().equals(accountId);
        if (!visible) {
            throw new NotFoundException("No such category");
        }
        return category;
    }
}
