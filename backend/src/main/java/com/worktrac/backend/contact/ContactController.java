package com.worktrac.backend.contact;

import com.worktrac.backend.security.CurrentUser;
import com.worktrac.backend.security.RequestDiagnosticsFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

// Deliberately NOT in SecurityConfig's permitAll() list: requiring authentication is the single
// strongest abuse control available here, and it is what makes a CAPTCHA unnecessary. There is no
// anonymous surface for a bot to reach. .anyRequest().authenticated() already covers this path, so
// this controller needs no security annotation of its own -- and it must never acquire one.
//
// No @CrossOrigin: CORS is configured globally in CorsConfig.
@RestController
@RequestMapping("/api/contact")
public class ContactController {

    private final ContactMessageService contactMessageService;
    private final CurrentUser currentUser;

    public ContactController(ContactMessageService contactMessageService, CurrentUser currentUser) {
        this.contactMessageService = contactMessageService;
        this.currentUser = currentUser;
    }

    // 202, not 201: the message is stored, but the thing the person actually cares about -- it
    // reaching a human -- completes asynchronously afterwards. There is no resource to hand back a
    // Location for, and no read endpoint to point at (see the plan's "no user-facing history").
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void submit(@Valid @RequestBody ContactRequest request, HttpServletRequest servletRequest) {
        // getRemoteAddr is the real client IP because server.forward-headers-strategy is `framework`
        // -- without it every external caller would share the Azure ingress hop as one bucket.
        contactMessageService.submit(currentUser.accountId(), currentUser.userId(), request,
                servletRequest.getRemoteAddr(),
                servletRequest.getHeader("User-Agent"),
                servletRequest.getHeader(RequestDiagnosticsFilter.CORRELATION_ID_HEADER));
    }
}
