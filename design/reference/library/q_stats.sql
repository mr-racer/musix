-- The statistics mock's data: the listening account's listen events (local time, UTC+3) and
-- what they point at. Read-only. psql -At < q_stats.sql > stats_src.json
with acc as (select id from accounts where id::text like 'c2b5b12d%')
select json_build_object(
 'events', (select json_agg(json_build_array(l.track_id, to_char((l.started_at at time zone 'UTC') + interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS'), l.played_ms, l.skipped_early) order by l.started_at)
   from listen_events l where l.account_id = (select id from acc)),
 'tracks', (select json_agg(json_build_array(t.id, coalesce(t.title_display, t.title), t.album_id, t.primary_artist_id, t.year, t.genre, t.duration_ms, t.cover_image_id, t.deleted_at is null, (select i.palette->'accent'->>'dark' from images i where i.id = t.cover_image_id)))
   from tracks t where t.account_id = (select id from acc)),
 'artists', (select json_agg(json_build_array(a.id, a.name, a.image_id, a.profile->>'countryCode'))
   from artists a where a.id in (select primary_artist_id from tracks where account_id = (select id from acc))),
 'albums', (select json_agg(json_build_array(al.id, al.title, al.cover_image_id, (select count(*) from tracks t where t.album_id = al.id and t.account_id = (select id from acc) and t.deleted_at is null)))
   from albums al where al.id in (select album_id from tracks where account_id = (select id from acc)))
);
