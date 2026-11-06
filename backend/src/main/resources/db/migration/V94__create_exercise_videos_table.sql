-- A how-to video for a LIBRARY exercise: a pointer to a public YouTube video, played in the app
-- through its own /embed/youtube.html page (frontend/public/embed/), never stored or proxied.
--
--   video_id      the 11-character YouTube id, never a URL. The client builds the only URL it
--                 ever uses, so a row cannot point the player anywhere but YouTube.
--   start_seconds where the demonstration starts, when the video opens with a talking intro.
--   source_label  who made the video, shown under the player ("Video: <source_label> on YouTube").
--   status        'active' is shown; 'unavailable' is not. ExerciseVideoChecker sets it from
--                 YouTube's oEmbed answer (removed, made private, or embedding turned off), and
--                 flips it back when the video returns. Rows are never deleted by the checker.
--   checked_at    when the checker last got a definite answer; NULL until it has.
--
-- One video per exercise (UQ). Library exercises only: there is no API that writes this table, and
-- the rows arrive by migration like the rest of the library (CLAUDE.md, "seed data goes in
-- migrations"); ExerciseVideoRepository reads only rows whose exercise has no account. ON DELETE
-- CASCADE for the same reason as exercise_muscles (V92): a video means nothing without its exercise.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'exercise_videos')
BEGIN
    CREATE TABLE exercise_videos (
        id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_exercise_videos PRIMARY KEY,
        exercise_id   BIGINT        NOT NULL,
        provider      NVARCHAR(20)  NOT NULL CONSTRAINT DF_exercise_videos_provider DEFAULT 'youtube'
            CONSTRAINT CK_exercise_videos_provider CHECK (provider IN ('youtube')),
        video_id      NVARCHAR(11)  NOT NULL
            CONSTRAINT CK_exercise_videos_video_id CHECK (LEN(video_id) = 11),
        start_seconds INT           NULL
            CONSTRAINT CK_exercise_videos_start CHECK (start_seconds IS NULL OR start_seconds >= 0),
        source_label  NVARCHAR(100) NOT NULL,
        status        NVARCHAR(20)  NOT NULL CONSTRAINT DF_exercise_videos_status DEFAULT 'active'
            CONSTRAINT CK_exercise_videos_status CHECK (status IN ('active', 'unavailable')),
        checked_at    DATETIME2     NULL,
        CONSTRAINT FK_exercise_videos_exercise FOREIGN KEY (exercise_id)
            REFERENCES exercises(id) ON DELETE CASCADE,
        CONSTRAINT UQ_exercise_videos_exercise UNIQUE (exercise_id)
    );
END
