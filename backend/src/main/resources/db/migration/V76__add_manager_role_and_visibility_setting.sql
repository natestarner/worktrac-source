-- Pro's two schema needs: a third account role, and a way to actually change the member-visibility
-- setting V66 deliberately shipped as read-only.

-- MANAGER: full reach over everyone in the account, no say over the account itself. An assistant
-- trainer in a Pro practice, an assistant coach on a Team, a second parent on a family account.
--
-- V63's CHECK listed the two roles that existed then. It has to be dropped and recreated -- T-SQL
-- has no ALTER for a check's expression -- and the recreate is what keeps the constraint's value:
-- it still refuses a role the application does not know, which is what makes a typo'd or
-- hand-inserted row fail loudly rather than resolve to something surprising at runtime.
--
-- ⚠️ The DEFAULT stays MEMBER (V63). That is fail-closed and must not be "improved" to MANAGER for
-- convenience: a row that arrives without a role should be able to do LESS than intended, never
-- more. V63's own header spells out why -- "this person cannot do enough" gets reported in a
-- minute; "this person can do everything" gets noticed by nobody.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_account_memberships_role')
BEGIN
    ALTER TABLE account_memberships DROP CONSTRAINT CK_account_memberships_role;
END

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_account_memberships_role')
BEGIN
    ALTER TABLE account_memberships ADD CONSTRAINT CK_account_memberships_role
        CHECK (account_role IN ('OWNER', 'MANAGER', 'MEMBER'));
END

-- No data migration: MANAGER is a role somebody is invited INTO, never one an existing membership
-- becomes. Every current row is an OWNER or a MEMBER and stays exactly what it is.
--
-- `accounts.members_see_everyone` (V66) needs no DDL either -- the column has been there, correct
-- and forced to 1, since the day it shipped. What changes is in Java: Account gains a setter and
-- MembershipLoginController gains an endpoint, so the Pro tier can turn it OFF. V66's header said
-- not to "finish" it until the tier that needed it arrived; this is that tier.
