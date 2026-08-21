package com.worktrac.backend.contact;

// Kept to three so the picker fits one row on a phone held in portrait mid-workout. The values are
// mirrored by CK_contact_messages_category in V51 -- adding one means a new migration, not just a
// new constant here.
public enum ContactCategory {
    SUGGESTION,
    BUG,
    OTHER
}
