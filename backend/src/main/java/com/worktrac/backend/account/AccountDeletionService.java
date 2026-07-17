package com.worktrac.backend.account;

import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.tag.TagRepository;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Permanently erases an account and everything under it. Order matters: people must go
// first so the existing DB cascades (routines/routine_exercises, workout_sessions/
// workout_sets, person_exercise -> person_exercise_fields/person_exercise_tags) fire and
// clear the FK rows that still reference this account's exercises
// (routine_exercises.exercise_id, workout_sets.exercise_id have no cascade of their own).
// Tags are account-scoped and cleared explicitly below. Only rows with this exact account_id
// are ever touched -- global/shared library exercises (NULL account_id) are never selected.
@Service
public class AccountDeletionService {

    private static final Logger log = LoggerFactory.getLogger(AccountDeletionService.class);

    private final PersonRepository personRepository;
    private final ExerciseRepository exerciseRepository;
    private final TagRepository tagRepository;
    private final UserRepository userRepository;
    private final AccountRepository accountRepository;

    public AccountDeletionService(PersonRepository personRepository, ExerciseRepository exerciseRepository,
                                   TagRepository tagRepository, UserRepository userRepository,
                                   AccountRepository accountRepository) {
        this.personRepository = personRepository;
        this.exerciseRepository = exerciseRepository;
        this.tagRepository = tagRepository;
        this.userRepository = userRepository;
        this.accountRepository = accountRepository;
    }

    @Transactional
    public void deleteAccount(Long accountId) {
        personRepository.deleteByAccount_Id(accountId);
        exerciseRepository.deleteByAccount_Id(accountId);
        tagRepository.deleteByAccount_Id(accountId);
        userRepository.deleteByAccount_Id(accountId);
        accountRepository.deleteById(accountId);
        log.info("Deleted account {}", accountId);
    }
}
