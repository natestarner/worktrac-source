-- Who in the household created this shared row.
--
-- Exercises and tags belong to the ACCOUNT, not to a person -- everyone in the household picks
-- from the same pool. That was unambiguous while an account had exactly one login. With member
-- logins it stops being enough: a member may create an exercise or a tag (they must be able to --
-- it is a durable offline write) and may edit what they created, but not what somebody else did.
-- Nothing in the schema could answer "who made this" until now.
--
-- One column, two tables, one reason -- so one migration, following
-- V54__add_import_batch_id_to_workout_data.sql's precedent for exactly this shape.
--
-- NULLABLE, and null is meaningful rather than merely unbacked:
--   * a GLOBAL exercise (account_id IS NULL) is preloaded catalog -- nobody in a household created
--     it, and it is already immutable to everyone (ExerciseService.update rejects it outright);
--   * a row written by the previous release during a rolling deploy genuinely has no answer;
--   * an account with no OWNER membership has nobody for V69 to attribute to.
-- All three fail CLOSED: only a login holding EDIT_ANY_SHARED_RESOURCE (the owner) can edit a row
-- nobody claims. That locks nobody out and hands members nothing they did not make.
--
-- The foreign keys and indexes are added separately in V68, because SQL Server cannot reference a
-- column added earlier in the same un-batched script -- the same reason V40/V41, V42/V43, V47/V48
-- and V54/V55 are split pairs.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('exercises') AND name = 'created_by_user_id')
BEGIN
    ALTER TABLE exercises ADD created_by_user_id BIGINT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tags') AND name = 'created_by_user_id')
BEGIN
    ALTER TABLE tags ADD created_by_user_id BIGINT NULL;
END
