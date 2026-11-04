# Modifications relative to upstream

Base: `djkcyl/arkstage` commit `a4b9ab8` (AGPL-3.0-only).

This fork focuses on the Android/mobile reading experience and on making the
official bilibili PV archive usable inside the reader.

## bilibili PV catalog and playback

- Added `frontend/src/lib/bilibiliPvCatalog.ts`, an offline catalog parsed from
  the public PRTS Wiki page `衍生作品/影像` (活动宣传PV, 先导PV, 概念PV,
  スペシャルPV). It contains identifiers and official type names only; no
  third-party media files.
- Added `bilibili_pv_list` in `src-tauri/src/bilibili.rs`, which merges several
  strict official-account searches for new/unknown books. Matching is
  case-insensitive, supports `概念PV` / `概念pv`, and uses `order=pubdate` to
  avoid the default ranking hiding official uploads.
- Added in-app native MP4 playback through bilibili `playurl`, with
  1080P/720P/480P selection, a custom control bar, and no native full-screen
  player UI. Quality depends on the logged-in bilibili account.
- Added bilibili app QR/app login session persistence and Android cookie
  handling through `android.webkit.CookieManager`.
- Added PV type tabs so every found official PV for a book is selectable by its
  own official type name. A book without any matching official PV gets no
  button.

## Reading progress and navigation

- Line-level resume: the displayed line and decision choices are saved to
  local storage and restored on re-entry.
- Decision-point resume: if a save lands on a choice, the resume overlay is
  released when the engine reaches `waiting_decision`, so the choice UI is
  usable instead of being blocked by "定位中".
- Finishing a section now records the **next** section as "last watched"; if
  there is no next section, the current one is kept.
- Chapter-directory and chapter-detail scroll positions, category filters, and
  chapter fold state are persisted across opening a book/player and returning.

## UI and media

- Custom chapter-opening player with delayed UI hiding and CSS full-screen
  behavior (no native video controls).
- Mobile-first chapter discovery improvements, cover/directory polish, and
  safe-area handling.
- Local PRTS opening animations remain available; the bilibili PV entry is
  shown alongside them when an official PV exists.

## Licensing note

The fork retains the upstream `LICENSE` (AGPL-3.0-only), `LICENSE-SCOPE.md`,
README disclaimer, and all upstream copyright notices. Third-party Arknights /
PRTS / bilibili media is not relicensed and is not included in this repository.
