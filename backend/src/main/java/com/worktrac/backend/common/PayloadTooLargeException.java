package com.worktrac.backend.common;

// The request body exceeded the cap for its route (see RequestLimitProperties). Answered with 413.
//
// 413 is deliberate and it is a durability decision: shouldRetryWrite treats any 4xx outside
// {408, 429} as terminal, so a durable write rejected this way is discarded rather than retried
// forever. That is the correct outcome -- a body over the cap is genuinely impossible to accept,
// and no amount of retrying changes that. Answering 5xx instead would leave a poison message
// replaying out of the outbox for the life of the install.
public class PayloadTooLargeException extends RuntimeException {

    public PayloadTooLargeException(String message) {
        super(message);
    }
}
