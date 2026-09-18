package com.worktrac.backend.admin;

import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.ClientBand;

/**
 * What an admin is granting, and why.
 *
 * <p>⚠️ <b>Deliberately the smallest body that can express the request.</b> It carries no account
 * id (that is the path variable), no acting-admin identity (that comes from the authenticated
 * principal -- a self-reported actor is not an audit trail), and no {@code comped} flag of its own.
 * Every field a request body carries is a field a caller controls, so the ones that decide
 * authority or accountability must not be here at all.
 *
 * <p>Both enums are bound by name. An unrecognised value fails Jackson's deserialization and is
 * answered as a 400 by {@code GlobalExceptionHandler}, which is the right polarity: a plan or band
 * this build does not know is a request to refuse, never one to guess at. Contrast
 * {@code TestSupportController.parsePlan}, which falls back to FREE on an unknown name -- that
 * leniency is correct for a test helper whose job is to let the spec's own assertion be the failure,
 * and wrong for a privileged production write.
 *
 * @param plan the tier to grant. Must be a paid tier; FREE is refused, because removing a grant is
 *             {@code DELETE} and has its own audit event.
 * @param band required for PRO and refused for every other tier, mirroring {@code PlanSku.of}'s
 *             rule about combinations we sell.
 * @param note free text, the reason, bounded at 200 characters to match {@code comp_note}. Optional.
 */
public record AdminCompRequest(BillingPlan plan, ClientBand band, String note) {
}
