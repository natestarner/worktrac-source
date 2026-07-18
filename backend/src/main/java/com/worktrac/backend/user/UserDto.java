package com.worktrac.backend.user;

public record UserDto(Long id, String email, String role) {

    public static UserDto from(User user) {
        return new UserDto(user.getId(), user.getEmail(), user.getRole());
    }
}
