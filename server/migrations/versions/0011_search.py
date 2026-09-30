"""Catalog search in Postgres (spec §4): one IMMUTABLE key function applied to both the
documents and the query, so they are normalised identically — v1 `text_normalize.fold`
(NFKD, combining marks dropped, lowercase, every non-alphanumeric a space) and then
Cyrillic → Latin with v1's `_CYR_TO_LAT` map, so «Кино» and "kino" meet. Trigram GIN
indexes on the keys serve similarity, typos and prefixes.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-30
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(r"""
    CREATE FUNCTION musix_fold(t text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
        SELECT btrim(regexp_replace(lower(
            regexp_replace(normalize(t, NFKD), '[̀-ͯ᪰-᫿⃐-⃿]', '', 'g')
        ), '[^[:alnum:]]+', ' ', 'g'))
    $$;
    CREATE FUNCTION musix_key(t text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
        SELECT translate(
            replace(replace(replace(replace(replace(replace(replace(replace(replace(
                public.musix_fold(t),  -- qualified: index builds run with a restricted search_path (PG17+)
                'щ', 'shch'), 'ж', 'zh'), 'ц', 'ts'), 'ч', 'ch'), 'ш', 'sh'),
                'ю', 'yu'), 'я', 'ya'), 'ъ', ''), 'ь', ''),
            'абвгдезиклмнопрстуфхыэ', 'abvgdeziklmnoprstufhye')
    $$;
    CREATE INDEX tracks_title_key_trgm ON tracks
        USING gin (musix_key(coalesce(title_display, title)) gin_trgm_ops) WHERE deleted_at IS NULL;
    CREATE INDEX albums_title_key_trgm ON albums USING gin (musix_key(title) gin_trgm_ops);
    CREATE INDEX artists_name_key_trgm ON artists USING gin (musix_key(name) gin_trgm_ops);
    """)


def downgrade() -> None:
    op.execute("""
    DROP INDEX artists_name_key_trgm, albums_title_key_trgm, tracks_title_key_trgm;
    DROP FUNCTION musix_key(text); DROP FUNCTION musix_fold(text);
    """)
