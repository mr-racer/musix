with acc as (select id from accounts where id::text like 'c2b5b12d%'),
al as (select a.* from albums a where a.id in (
 '01a0f617-e9a1-78d8-ae95-9dc9f481e091','01a0f617-b064-710b-aa9f-2bd2ad0bb9ea','01a0f617-af58-75bb-8673-62d772eb05a7',
 '01a0f617-b7c7-77c6-a74a-dd2b30f89306','01a0f617-f661-79a3-b3b8-385c486a5547','01a0f617-b387-7de5-a929-4e806b9f0075',
 '01a0f617-af9e-7c6a-98b1-bb483a4acb10','01a0f617-b585-7b39-9284-20e2c9b21179','01a0f617-e992-7943-96e5-8a9bedcdc6c6'))
select json_agg(json_build_object(
 'id', al.id, 'title', al.title, 'year', al.year, 'cover', al.cover_image_id,
 'artist', (select json_build_object('id', ar.id, 'name', ar.name) from artists ar where ar.id = al.album_artist_id),
 'palette', (select palette from images i where i.id = al.cover_image_id),
 'tracks', (select json_agg(json_build_object('id', t.id, 'title', coalesce(t.title_display, t.title), 'no', t.track_no, 'disc', t.disc_no, 'ms', t.duration_ms, 'genre', t.genre,
     'codec', m.codec, 'plays', coalesce(s.plays,0), 'last', s.last_played_at,
     'artists', (select json_agg(json_build_object('id', a2.id, 'name', a2.name, 'role', ta.role) order by ta.position) from track_artists ta join artists a2 on a2.id = ta.artist_id where ta.track_id = t.id))
   order by t.disc_no nulls first, t.track_no nulls last, t.title)
   from tracks t join media_files m on m.id = t.media_file_id left join account_track_stats s on s.track_id = t.id and s.account_id = t.account_id
   where t.album_id = al.id and t.account_id = (select id from acc) and t.deleted_at is null),
 'producers', (select json_agg(x) from (select r.target_text n, count(distinct r.song_id) c from song_relations r join tracks t on t.song_id = r.song_id
   where t.album_id = al.id and t.account_id = (select id from acc) and t.deleted_at is null and r.kind = 'producer' group by 1 order by 2 desc, 1 limit 6) x),
 'labels', (select json_agg(x) from (select r.target_text n, count(distinct r.song_id) c from song_relations r join tracks t on t.song_id = r.song_id
   where t.album_id = al.id and t.account_id = (select id from acc) and t.deleted_at is null and r.kind = 'label' group by 1 order by 2 desc limit 3) x),
 'more', (select json_agg(x) from (select a3.id, a3.title, a3.year, a3.cover_image_id cover from albums a3 where a3.album_artist_id = al.album_artist_id and a3.id <> al.id
   and exists (select 1 from tracks t where t.album_id = a3.id and t.account_id = (select id from acc) and t.deleted_at is null) order by a3.year desc nulls last limit 30) x)
)) from al;
