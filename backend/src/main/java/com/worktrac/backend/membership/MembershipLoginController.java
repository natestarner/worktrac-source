package com.worktrac.backend.membership;

import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The owner's login manager: who in this household can sign in, and inviting the ones who cannot.
 *
 * <p>Its own controller rather than more methods on {@code AccountController} because this is a
 * distinct concern with a distinct permission ({@code MANAGE_LOGINS}), and because every route here
 * is owner-only while that one is a mix.
 *
 * <p>Accepting an invitation is deliberately NOT here — it lives on {@code AuthController}, since
 * the caller has no session yet and the response is one.
 */
@RestController
@RequestMapping("/api/account/logins")
public class MembershipLoginController {

    private final MembershipInviteService inviteService;
    private final CurrentUser currentUser;

    public MembershipLoginController(MembershipInviteService inviteService, CurrentUser currentUser) {
        this.inviteService = inviteService;
        this.currentUser = currentUser;
    }

    public record InviteRequest(@NotBlank @Email String email) {
    }

    @GetMapping
    @RequiresPermission(Permission.MANAGE_LOGINS)
    public List<PersonLoginDto> logins() {
        return inviteService.logins(currentUser.access());
    }

    /**
     * Invites (or re-invites) one person to take over their own login.
     *
     * <p>⚠️ <b>The response is the same row whatever the state of the invited address.</b> It says
     * {@code INVITED} and nothing else — never "they already had an account", never "activated".
     * Anything richer here is a user-enumeration oracle; see {@link MembershipInviteService}'s
     * class comment for the full reasoning.
     *
     * <p>The email is dispatched by the service, on an {@code AFTER_COMMIT} listener, so a slow or
     * failing send can never roll back the invitation itself — the same ordering registration
     * uses. It is deliberately NOT published from here: an {@code AFTER_COMMIT} listener silently
     * discards anything published once the service transaction has already committed, which is
     * exactly the bug {@code MembershipInviteService#announce} documents.
     */
    @PostMapping("/{personId}/invite")
    @RequiresPermission(Permission.MANAGE_LOGINS)
    public PersonLoginDto invite(@PathVariable Long personId, @Valid @RequestBody InviteRequest request) {
        MembershipInvite invite = inviteService.invite(currentUser.access(), personId, request.email()).invite();
        return new PersonLoginDto(personId, invite.getPerson().getName(),
                PersonLoginDto.INVITED, invite.getEmail());
    }

    /**
     * Removes a login, or withdraws an invitation that was never accepted — one action for both,
     * because the owner should not have to know which state somebody was in to undo it.
     *
     * <p>Answers 204 whether or not there was anything to revoke: the intent ("this person should
     * not have a login") is true either way, and a 404 would only invite a retry.
     */
    @DeleteMapping("/{personId}")
    @RequiresPermission(Permission.MANAGE_LOGINS)
    public ResponseEntity<Void> revoke(@PathVariable Long personId) {
        inviteService.revoke(currentUser.access(), personId);
        return ResponseEntity.noContent().build();
    }
}
