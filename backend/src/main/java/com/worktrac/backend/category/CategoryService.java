package com.worktrac.backend.category;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.exercise.ExerciseRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class CategoryService {

    private final CategoryRepository categoryRepository;
    private final AccountRepository accountRepository;
    private final ExerciseRepository exerciseRepository;

    public CategoryService(CategoryRepository categoryRepository, AccountRepository accountRepository,
                            ExerciseRepository exerciseRepository) {
        this.categoryRepository = categoryRepository;
        this.accountRepository = accountRepository;
        this.exerciseRepository = exerciseRepository;
    }

    @Transactional(readOnly = true)
    public List<CategoryDto> list(Long accountId) {
        return categoryRepository.findVisibleToAccount(accountId).stream()
                .map(CategoryDto::from)
                .toList();
    }

    @Transactional
    public CategoryDto add(Long accountId, String name) {
        Account account = accountRepository.getReferenceById(accountId);
        Category category = categoryRepository.save(new Category(account, name.trim()));
        return CategoryDto.from(category);
    }

    @Transactional
    public void remove(Long accountId, Long categoryId) {
        Category category = categoryRepository.findById(categoryId)
                .orElseThrow(() -> new NotFoundException("No such category"));
        boolean visible = category.isGlobal() || category.getAccount().getId().equals(accountId);
        if (!visible) {
            throw new NotFoundException("No such category");
        }
        if (category.isGlobal()) {
            throw new ForbiddenException("Cannot delete a global category");
        }
        if (exerciseRepository.existsByCategory_Id(categoryId)) {
            throw new ConflictException("Cannot delete a category that still has exercises assigned to it");
        }
        categoryRepository.delete(category);
    }
}
