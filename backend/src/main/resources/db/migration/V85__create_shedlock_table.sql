-- ShedLock's lock table (SchedulingConfig). One row per @Scheduled job, keyed by the job's
-- @SchedulerLock name. Every replica's scheduler still fires on its own timer; before the job body
-- runs, ShedLock does one atomic INSERT-or-UPDATE ... WHERE lock_until <= now on that job's row, and
-- only the replica whose statement succeeds runs the job. The rest skip that tick.
--
-- Column names and shape are ShedLock's own (JdbcTemplateLockProvider expects them exactly), in
-- NVARCHAR/DATETIME2 per this project's T-SQL conventions. `lock_until` and `locked_at` are written
-- from the DATABASE's clock (usingDbTime()), so clock skew between replicas cannot hand the lock to
-- two of them at once.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shedlock')
BEGIN
    CREATE TABLE shedlock (
        name       NVARCHAR(64)  NOT NULL,
        lock_until DATETIME2     NOT NULL,
        locked_at  DATETIME2     NOT NULL,
        locked_by  NVARCHAR(255) NOT NULL,
        CONSTRAINT PK_shedlock PRIMARY KEY (name)
    );
END
