package com.worktrac.backend.user;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.security.JwtService;
import com.worktrac.backend.user.dto.AuthResponse;
import com.worktrac.backend.user.dto.LoginRequest;
import com.worktrac.backend.user.dto.MeResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class AuthService {

    private static final String ROLE_ADMIN = "ADMIN";
    private static final String ROLE_USER = "USER";

    private final AccountRepository accountRepository;
    private final UserRepository userRepository;
    private final PersonRepository personRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AdminProperties adminProperties;

    public AuthService(AccountRepository accountRepository, UserRepository userRepository,
                        PersonRepository personRepository, PasswordEncoder passwordEncoder,
                        JwtService jwtService, AdminProperties adminProperties) {
        this.accountRepository = accountRepository;
        this.userRepository = userRepository;
        this.personRepository = personRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.adminProperties = adminProperties;
    }

    @Transactional
    public AuthResponse login(LoginRequest request) {
        String email = request.email().trim().toLowerCase();
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new UnauthorizedException("Invalid email or password"));
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new UnauthorizedException("Invalid email or password");
        }
        reconcileAdminRole(user);
        Account account = user.getAccount();
        Person primaryPerson = personRepository.findByAccount_IdOrderByCreatedAtAsc(account.getId()).stream()
                .filter(Person::isPrimary)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("Account has no primary person: " + account.getId()));

        String token = jwtService.generateToken(user.getId(), account.getId(), user.getEmail(), user.getRole());
        return new AuthResponse(token, UserDto.from(user), AccountDto.from(account), PersonDto.from(primaryPerson));
    }

    // ADMIN_EMAILS is the real source of truth for who's an admin; the `role` column is
    // just a cache of it. Reconciling here (rather than only at startup, see
    // AdminBootstrap) means removing someone from the allowlist takes effect on their
    // very next login even without an app restart.
    private void reconcileAdminRole(User user) {
        boolean shouldBeAdmin = adminProperties.isAdminEmail(user.getEmail());
        String targetRole = shouldBeAdmin ? ROLE_ADMIN : ROLE_USER;
        if (!targetRole.equals(user.getRole())) {
            user.setRole(targetRole);
            userRepository.save(user);
        }
    }

    @Transactional(readOnly = true)
    public MeResponse me(Long userId, Long accountId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("User no longer exists"));
        Account account = accountRepository.findById(accountId)
                .orElseThrow(() -> new UnauthorizedException("Account no longer exists"));
        List<PersonDto> people = personRepository.findByAccount_IdOrderByCreatedAtAsc(accountId).stream()
                .map(PersonDto::from)
                .toList();
        return new MeResponse(UserDto.from(user), AccountDto.from(account), people);
    }
}
