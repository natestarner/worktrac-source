package com.worktrac.backend.user;

import com.worktrac.backend.security.CurrentUser;
import com.worktrac.backend.user.dto.AuthResponse;
import com.worktrac.backend.user.dto.ConfirmEmailRequest;
import com.worktrac.backend.user.dto.ForgotPasswordRequest;
import com.worktrac.backend.user.dto.LoginRequest;
import com.worktrac.backend.user.dto.MeResponse;
import com.worktrac.backend.user.dto.RegisterRequest;
import com.worktrac.backend.user.dto.RegisterStartedResponse;
import com.worktrac.backend.user.dto.ResendCodeRequest;
import com.worktrac.backend.user.dto.ResendResetCodeRequest;
import com.worktrac.backend.user.dto.ResetPasswordRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final RegistrationService registrationService;
    private final PasswordResetService passwordResetService;
    private final CurrentUser currentUser;

    public AuthController(AuthService authService, RegistrationService registrationService,
                           PasswordResetService passwordResetService, CurrentUser currentUser) {
        this.authService = authService;
        this.registrationService = registrationService;
        this.passwordResetService = passwordResetService;
        this.currentUser = currentUser;
    }

    @PostMapping("/register")
    public RegisterStartedResponse register(@Valid @RequestBody RegisterRequest request,
                                             HttpServletRequest servletRequest) {
        return registrationService.register(request, servletRequest.getRemoteAddr());
    }

    @PostMapping("/confirm-email")
    public AuthResponse confirmEmail(@Valid @RequestBody ConfirmEmailRequest request) {
        return registrationService.confirmEmail(request);
    }

    @PostMapping("/resend-code")
    public void resendCode(@Valid @RequestBody ResendCodeRequest request, HttpServletRequest servletRequest) {
        registrationService.resendCode(request, servletRequest.getRemoteAddr());
    }

    @PostMapping("/forgot-password")
    public void forgotPassword(@Valid @RequestBody ForgotPasswordRequest request, HttpServletRequest servletRequest) {
        passwordResetService.requestReset(request, servletRequest.getRemoteAddr());
    }

    @PostMapping("/reset-password")
    public void resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        passwordResetService.confirmReset(request);
    }

    @PostMapping("/resend-reset-code")
    public void resendResetCode(@Valid @RequestBody ResendResetCodeRequest request, HttpServletRequest servletRequest) {
        passwordResetService.resendResetCode(request, servletRequest.getRemoteAddr());
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @GetMapping("/me")
    public MeResponse me() {
        return authService.me(currentUser.userId(), currentUser.accountId());
    }
}
