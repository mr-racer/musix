"""«Поток» online: the versioned ranker, the decision log, session feedback, presets.

- `ranker_models`: every trained model with its metrics; `promoted` marks the one that
  serves (stream spec §3.2 promotion rule). The version is logged with every decision.
- `stream_decisions`: append-only, partitioned by month (spec §9) — the served track,
  its pool, sources, score, the top 30 with their scores, the exploration propensity,
  the fatigue trigger, model and policy versions. It is also the served log the policy
  reads (the 12-track preset window, no same-day repeats).
- `stream_feedback`: «Меньше такого» — a session-level down-weight of an artist or genre.
- `stream_presets`: the preset catalogue is data (spec §4): a new preset is a row.

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-30
"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE ranker_models (
        version integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        trained_at timestamptz NOT NULL DEFAULT now(),
        metrics jsonb NOT NULL,
        model text NOT NULL,
        promoted boolean NOT NULL DEFAULT false
    );
    CREATE UNIQUE INDEX ranker_models_one_promoted ON ranker_models (promoted) WHERE promoted;

    CREATE TABLE stream_decisions (
        id bigint GENERATED ALWAYS AS IDENTITY,
        account_id uuid NOT NULL,
        session_id text NOT NULL,
        track_id uuid NOT NULL,
        served_at timestamptz NOT NULL DEFAULT now(),
        pool text NOT NULL,
        sources text[] NOT NULL,
        score double precision,
        top jsonb NOT NULL,
        explore boolean NOT NULL DEFAULT false,
        propensity double precision,
        trigger text,
        reason text NOT NULL,
        model_version integer,
        policy_version text NOT NULL,
        PRIMARY KEY (served_at, id)
    ) PARTITION BY RANGE (served_at);
    CREATE TABLE stream_decisions_default PARTITION OF stream_decisions DEFAULT;
    CREATE INDEX stream_decisions_account_idx ON stream_decisions (account_id, served_at DESC);

    CREATE TABLE stream_feedback (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        session_id text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('less_like_this')),
        artist_id uuid, genre text,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX stream_feedback_session_idx ON stream_feedback (account_id, session_id);

    CREATE TABLE stream_presets (
        id text PRIMARY KEY,
        row text NOT NULL CHECK (row IN ('familiarity', 'sound')),
        position integer NOT NULL,
        label_ru text NOT NULL, label_en text NOT NULL, icon text NOT NULL,
        shares jsonb, energy_band text
    );
    INSERT INTO stream_presets VALUES
      ('mix',        'familiarity', 0, 'Микс',             'Mix',            'shuffle', '{"familiar": 0.5, "unplayed": 0.3, "rediscover": 0.2}', NULL),
      ('favorites',  'familiarity', 1, 'Любимое',          'Favorites',      'heart',   '{"familiar": 0.8, "rediscover": 0.2}', NULL),
      ('rediscover', 'familiarity', 2, 'Давно не слушал',  'Rediscover',     'history', '{"rediscover": 1.0}', NULL),
      ('unfamiliar', 'familiarity', 3, 'Незнакомое',       'Unfamiliar',     'sparkle', '{"unplayed": 1.0}', NULL),
      ('calm',       'sound',       0, 'Спокойное',        'Calm',           'moon',    NULL, 'low'),
      ('energetic',  'sound',       1, 'Бодрое',           'Energetic',      'bolt',    NULL, 'high');
    """)


def downgrade() -> None:
    op.execute("DROP TABLE stream_presets, stream_feedback, stream_decisions, ranker_models")
