# Surface: Library

v1 source: `LibrarySection` (l. 8330), `AlbumsGridTab`, `AlbumCard`, `AlbumListRow`,
`PlaylistsListView`, `StatsTab` (l. 8709). Golden: `design/golden/*/library-*`.

**Anatomy.**
- Tabs: Альбомы / Недавние / Плейлисты / Статистика.
- The album grid (`--lib-grid-min` 150 px, 132 px on phones; `--lib-grid-gap` 12 px) or a
  list view.
- Sorts: слушаю чаще / год / А-Я. Soft grouping.
- The album modal.

**Stats tab:**
- the listening timeline;
- «что ты дослушиваешь», «чаще всего бросаешь», «любишь по-настоящему»;
- streaks and the most active day;
- the collection map and the taste sonar;
- rhythm and engagement.

These are built from `RhythmReadout`, `SkeuoArcGauge`, `CompletionRing`, `Sparkline` and
`StatsDivider`.

**States:** loading skeletons (`Skel`), empty library, a playlist being created.
