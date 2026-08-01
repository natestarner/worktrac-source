package com.worktrac.backend.email;

// Thrown when Azure Communication Services completes a send poll without an exception but the
// resulting EmailSendResult's status isn't SUCCEEDED -- previously EmailService.send discarded
// that result entirely (response.getValue() with the value unused), so a non-exception ACS
// failure was completely invisible. The message carries the ACS status + error code + error
// message so RegistrationEmailEventListener's catch block has a real reason to record, not just
// this class's own name.
public class EmailSendException extends RuntimeException {

    public EmailSendException(String message) {
        super(message);
    }
}
