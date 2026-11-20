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
import org.springframework.web.bind.annotation.PutMapping;
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

    public record AddAndInviteRequest(@NotBlank String personName, @NotBlank @Email String email) {
    }

    /**
     * Creates a person and invites them in one motion — how a trainer onboards a client.
     *
     * <p>Requires BOTH permissions, because it does both things. An assistant who could invite but
     * not create people has no business reaching this by inviting a person they just made.
     *
     * <p>⚠️ The response is deliberately the same {@code INVITED} row
     * {@link #invite(Long, InviteRequest)} returns, for the same reason: anything richer is a
     * user-enumeration oracle. It carries the new person's id because the caller genuinely needs it
     * — that is identity the caller just created, not information about the invited address.
     *
     * <p>A refusal rolls the person back too; see {@code MembershipInviteService#addAndInvite}.
     */
    @PostMapping
    @RequiresPermission({Permission.MANAGE_PEOPLE, Permission.MANAGE_LOGINS})
    public PersonLoginDto addAndInvite(@Valid @RequestBody AddAndInviteRequest request) {
        MembershipInvite invite = inviteService
                .addAndInvite(currentUser.access(), request.personName(), request.email())
                .invite();
        return PersonLoginDto.invited(invite.getPerson().getId(), invite.getPerson().getName(),
                invite.getEmail());
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
     * <p>The email is an outbox row written by the service inside its own transaction and sent
     * after commit, so a slow or failing send can never roll back the invitation itself — the same
     * ordering registration uses. It is deliberately NOT published from here, where the service
     * transaction has already committed; {@code MembershipInviteService#announce} explains why.
     */
    @PostMapping("/{personId}/invite")
    @RequiresPermission(Permission.MANAGE_LOGINS)
    public PersonLoginDto invite(@PathVariable Long personId, @Valid @RequestBody InviteRequest request) {
        MembershipInvite invite = inviteService.invite(currentUser.access(), personId, request.email()).invite();
        // isSelf is false by construction: inviting yourself is impossible here -- the viewer
        // already holds the login they would be inviting, and invite() refuses a person who has
        // one with a 409 before reaching this line.
        // lockedUntil is null by construction: an invitation has no user behind it yet, so there is
        // no lockout to report.
        return PersonLoginDto.invited(personId, invite.getPerson().getName(), invite.getEmail());
    }

    /**
     * {@code MANAGER} or {@code MEMBER} — the only two values this accepts. OWNER is not on offer:
     * there is no way to hand over a household here, and a second owner is not a thing the app has.
     */
    public record RoleRequest(@NotBlank String role) {
    }

    /**
     * Makes a login "trusted" (MANAGER: logs for everyone except the owner, owns nothing about the
     * account) or turns that off again (MEMBER).
     *
     * <p>ASSIGN_ROLES, which only the OWNER holds — a manager can hold MANAGE_LOGINS and still never
     * reach this, so who else is trusted stays the owner's decision alone. Online-only on the client:
     * it changes what somebody else may do, and there is nothing to queue.
     *
     * <p>Answers the updated row so the screen shows what the server now holds.
     */
    @PutMapping("/{personId}/role")
    @RequiresPermission(Permission.ASSIGN_ROLES)
    public PersonLoginDto setRole(@PathVariable Long personId, @Valid @RequestBody RoleRequest request) {
        return inviteService.setRole(currentUser.access(), personId, request.role());
    }

    /**
     * Removes a login, or withdraws an invitation that was never accepted — one action for both,
     * because the owner should not have to know which state somebody was in to undo it.
     *
     * <p>Answers 204 whether or not there was anything to revoke: the intent ("this person should
     * not have a login") is true either way, and a 404 would only invite a retry.
     */
    /**
     * Clears a member's login lockout — the owner acting as the support desk.
     *
     * <p>204 whether or not they were locked: the owner's intent ("let them try again") is true
     * either way, and a 404 would only invite a retry. It grants nothing — see
     * {@code MembershipInviteService#clearLockout}.
     */
    @PostMapping("/{personId}/unlock")
    @RequiresPermission(Permission.MANAGE_LOGINS)
    public ResponseEntity<Void> unlock(@PathVariable Long personId) {
        inviteService.clearLockout(currentUser.access(), personId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{personId}")
    @RequiresPermission(Permission.MANAGE_LOGINS)
    public ResponseEntity<Void> revoke(@PathVariable Long personId) {
        inviteService.revoke(currentUser.access(), personId);
        return ResponseEntity.noContent().build();
    }
}
