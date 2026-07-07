package com.worktrac.backend.category;

import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/categories")
public class CategoryController {

    private final CategoryService categoryService;
    private final CurrentUser currentUser;

    public CategoryController(CategoryService categoryService, CurrentUser currentUser) {
        this.categoryService = categoryService;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<CategoryDto> list() {
        return categoryService.list(currentUser.accountId());
    }

    @PostMapping
    public CategoryDto add(@Valid @RequestBody AddCategoryRequest request) {
        return categoryService.add(currentUser.accountId(), request.name());
    }

    @DeleteMapping("/{categoryId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@PathVariable Long categoryId) {
        categoryService.remove(currentUser.accountId(), categoryId);
    }
}
