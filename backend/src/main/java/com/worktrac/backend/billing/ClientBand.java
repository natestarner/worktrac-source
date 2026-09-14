package com.worktrac.backend.billing;

// How many clients a Pro subscription is licensed for. Pro is the first tier priced by size, which
// is how every comparable trainer platform prices, so the number a trainer is buying has to be part
// of what they buy rather than an afterthought.
//
// ⚠️ THE LIMIT IS A CEILING ON NEW CLIENTS, NEVER A REVOCATION. Going over it -- which only happens
// by moving DOWN a band, since going over is refused at the point of adding -- refuses the next
// invite and the next person, and touches nothing that already exists. Every client already on the
// roster keeps their login, their history and their programs. That is the same promise the Plus
// pause makes ("nothing is deleted, and nothing is revoked") and it is not negotiable here either:
// a billing change must never cost somebody else their access.
//
// Only PRO uses this. FREE and PLUS are household tiers and have no seats at all -- their ceiling
// is QuotaProperties.peoplePerAccount, which is about a family being a family rather than about
// what was paid for.
public enum ClientBand {

    STARTER(5),
    STUDIO(15),
    PRACTICE(40),

    /** No ceiling. Still bounded in practice by QuotaProperties.peoplePerAccount's upper bound. */
    UNLIMITED(null);

    private final Integer clientLimit;

    ClientBand(Integer clientLimit) {
        this.clientLimit = clientLimit;
    }

    /**
     * How many clients this band licenses, or null for no limit.
     *
     * <p>Null rather than Integer.MAX_VALUE: "unlimited" and "a very large number" read the same in
     * a comparison and completely differently in copy, and the billing screen has to say one of
     * them. A sentinel would make "12 of 2147483647 clients" a reachable string.
     */
    public Integer clientLimit() {
        return clientLimit;
    }

    /** Whether adding one more client would exceed what this band licenses. */
    public boolean allows(int currentClientCount) {
        return clientLimit == null || currentClientCount < clientLimit;
    }
}
