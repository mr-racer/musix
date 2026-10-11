-- The library mock's data: the listening account's albums, artists, playlists, tracks (for
-- search) and the taste map's clusters. Read-only. psql -At < q.sql > library.json
with acc as (select id from accounts where id::text like 'c2b5b12d%'),
tr as (select t.* from tracks t where t.account_id = (select id from acc) and t.deleted_at is null),
st as (select s.* from account_track_stats s where s.account_id = (select id from acc)),
tm as (select (data->'trackIds') ids, (data->'cluster') cl, data->'clusters' cs from taste_maps where account_id = (select id from acc)),
tc as (select (tm.ids->>(i-1))::uuid track_id, (tm.cl->>(i-1))::int c from tm, generate_series(1, jsonb_array_length(tm.ids)) i)
select json_build_object(
 'albums', (select json_agg(x) from (
   select al.id, al.title, al.year, al.cover_image_id cover,
     (select json_build_object('id', ar.id, 'name', ar.name) from artists ar where ar.id = al.album_artist_id) artist,
     (select (i.palette->'accent'->>'dark') from images i where i.id = al.cover_image_id) acc,
     (select json_build_array(i.palette->>'dominant', i.palette->>'muted') from images i where i.id = al.cover_image_id) pal,
     count(tr.id) n, sum(tr.duration_ms) ms, min(tr.added_at) added,
     coalesce(sum(st.plays), 0) plays, max(st.last_played_at) last,
     mode() within group (order by tr.genre) genre,
     mode() within group (order by tc.c) cl
   from albums al join tr on tr.album_id = al.id left join st on st.track_id = tr.id left join tc on tc.track_id = tr.id
   group by al.id) x),
 'artists', (select json_agg(x) from (
   select ar.id, ar.name, ar.sort_name, ar.image_id img, ar.cutout_id cut, ar.profile->>'countryCode' cc,
     (select json_build_array(i.palette->>'dominant', i.palette->>'muted') from images i where i.id = ar.image_id) pal, count(distinct tr.id) n, count(distinct tr.album_id) albums,
     coalesce(sum(st.plays), 0) plays, max(st.last_played_at) last
   from artists ar join track_artists ta on ta.artist_id = ar.id join tr on tr.id = ta.track_id left join st on st.track_id = tr.id
   group by ar.id) x),
 'playlists', (select json_agg(x) from (
   select p.id, p.name, p.updated_at, count(pi.track_id) n,
     (select json_agg(c) from (select t2.cover_image_id c from playlist_items p2 join tracks t2 on t2.id = p2.track_id
        where p2.playlist_id = p.id and p2.deleted_at is null and t2.cover_image_id is not null
        group by t2.cover_image_id order by min(p2.position) limit 4) y) covers
   from playlists p left join playlist_items pi on pi.playlist_id = p.id and pi.deleted_at is null
   where p.account_id = (select id from acc) and p.deleted_at is null group by p.id) x),
 'tracks', (select json_agg(json_build_array(tr.id, coalesce(tr.title_display, tr.title), tr.artist_display, tr.album_id, tr.primary_artist_id, coalesce(st.plays, 0)))
   from tr left join st on st.track_id = tr.id),
 'clusters', (select cs from tm)
);
