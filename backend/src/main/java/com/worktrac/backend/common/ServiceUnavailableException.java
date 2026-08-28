package com.worktrac.backend.common;

// A dependency this endpoint needs is not configured or not reachable, and that is the SERVER's
// problem rather than the caller's -- so it must answer 503, never 500 and never a 4xx.
//
// The distinction matters more than it looks. The frontend treats a 5xx as "server unreachable"
// and degrades accordingly, while a 4xx is a definitive rejection that ends a durable write's
// retries for good (see shouldRetryWrite). Answering 500 instead would be honest about the status
// class but loses the "this is expected and temporary" signal in the logs; answering 4xx would tell
// the client its request was wrong when it was fine.
//
// First use: billing endpoints in an environment with no Stripe configuration. Never defaults open
// -- an unconfigured environment refuses rather than pretending nobody is subscribed.
public class ServiceUnavailableException extends RuntimeException {

    public ServiceUnavailableException(String message) {
        super(message);
    }
}
