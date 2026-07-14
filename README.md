<p align="center">
  <img src="./docs/assets/aeon-round.png" width="160" alt="Aeon">
</p>

<h1 align="center">Aeon</h1>

<p align="center"><strong>Open-source manhwa discovery app.</strong></p>

<p align="center">
  <a href="https://zerodox9000-eng.github.io/Manhwa_pwa/"><img src="https://img.shields.io/badge/Open%20App-00a9bd?style=for-the-badge" alt="Open app"></a>
  <a href="https://github.com/zerodox9000-eng/Manhwa_pwa"><img src="https://img.shields.io/badge/Source-20232a?style=for-the-badge&logo=github&logoColor=white" alt="Source code"></a>
  <a href="https://www.reddit.com/u/ZERO_DOX/"><img src="https://img.shields.io/badge/Creator-ZERO__DOX-20232a?style=for-the-badge&logo=reddit&logoColor=white" alt="Creator profile"></a>
</p>

<p align="center">
  <img src="./docs/assets/aeon-home.jpg" width="430" alt="Aeon Home showing a focused manhwa feed">
</p>

<p align="center">Browse rule-based feeds, personal collections, and title details from one local catalogue.</p>

## About

Aeon organizes a large manhwa catalogue into feeds that can be browsed and customized. It supports rule-based discovery, fixed personal collections, title and creator search, detailed title pages, and portable JSON backups. No account is required.

## Features

- Swipe between feeds while retaining each feed's position.
- Create rule-based feeds with tags, dates, status, chapters, audience ranges, and layered sorting.
- Build fixed collections in MY LIST and arrange their titles manually or automatically.
- Organize feeds into reorderable segments and choose which segments appear on Home.
- Search primary titles, aliases, word fragments in any order, and creator names.
- Search within a feed while preserving each title's original feed rank.
- View synopses, creators, publication details, chapters, tags, audience statistics, and source links.
- Share individual feeds by link or JSON, merge imported feeds and segments, and export full backups.

## LIST and MY LIST

**LIST** contains dynamic feeds. Their membership updates from saved rules as the catalogue changes.

**MY LIST** contains fixed collections. Titles remain in the collection until they are manually added or removed. Display filters and sorting do not change membership.

Both libraries use segments for ordering and Home visibility.

## Screenshots

<table width="100%">
  <tr>
    <td width="50%" align="center"><img src="./docs/assets/aeon-home.jpg" width="300" alt="Aeon Home"></td>
    <td width="50%" align="center"><img src="./docs/assets/aeon-library.jpg" width="300" alt="Aeon feed library"></td>
  </tr>
  <tr>
    <td align="center">Home</td>
    <td align="center">Feeds</td>
  </tr>
</table>

<table width="100%">
  <tr>
    <td width="50%" align="center"><img src="./docs/assets/aeon-search.jpg" width="300" alt="Aeon catalogue search"></td>
    <td width="50%" align="center"><img src="./docs/assets/aeon-details.jpg" width="230" alt="Aeon title details"></td>
  </tr>
  <tr>
    <td align="center">Search</td>
    <td align="center">Title details</td>
  </tr>
</table>

## Fan Rank

Fan Rank compares favourites with popularity, adjusts for confidence at different audience sizes, and ranks the result as a percentile across AniList-mapped manhwa with the required statistics. It provides engagement context rather than another measure of raw popularity.

## Local data

Feeds, MY LIST collections, segments, display settings, and the last app position are stored in the browser. Sensitive catalogue areas remain hidden until enabled in Settings. A JSON backup can move or restore the complete setup.

## Data sources

<p>
  <a href="https://mangabaka.dev/"><img src="https://img.shields.io/badge/MangaBaka-0b7285?style=for-the-badge" alt="MangaBaka"></a>
  <a href="https://anilist.co/"><img src="https://img.shields.io/badge/AniList-2563eb?style=for-the-badge" alt="AniList"></a>
  <a href="https://www.mangaupdates.com/"><img src="https://img.shields.io/badge/MangaUpdates-7c3aed?style=for-the-badge" alt="MangaUpdates"></a>
  <a href="https://www.anime-planet.com/"><img src="https://img.shields.io/badge/Anime--Planet-e11d48?style=for-the-badge" alt="Anime-Planet"></a>
</p>

MangaBaka supplies the main catalogue, covers, publication details, links, and tag hierarchy. AniList supplies audience statistics for mapped titles. MangaUpdates and Anime-Planet are linked when available.

Aeon is independent and is not affiliated with these services or with the publishers and creators represented in the catalogue.

## Project

Aeon is an open-source project created and maintained by [ZERO_DOX](https://www.reddit.com/u/ZERO_DOX/). Its catalogue and daily data pipeline are maintained in [`zerodox9000-eng/manhwa_db`](https://github.com/zerodox9000-eng/manhwa_db).

Contributor guidance is available in [AGENTS.md](./AGENTS.md), with a concise frontend handoff in [docs/frontend-agent-notes.md](./docs/frontend-agent-notes.md).
