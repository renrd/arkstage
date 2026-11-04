import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Book } from "../lib/bookshelf";
import { cachedKey } from "../lib/bookshelf";
import { coverFallback } from "../lib/cover";
import { useBookshelfMetadata, type ResolvedArt } from "../lib/BookshelfMetadataContext";
import { useLongPress } from "../lib/useLongPress";
import { openingForBook } from "../lib/chapterOpenings";
import { externalOpeningForBook, isMainStoryBook, type ExternalOpening } from "../lib/externalOpenings";
import { pvListForBook } from "../lib/bilibiliPvCatalog";
import ChapterOpening from "./ChapterOpening";
import BilibiliPlayer from "./BilibiliPlayer";
import type { StoryChapter } from "../hooks/useStoryIndex";

// Per app session: books already checked and confirmed to have no official
// 活动先导PV. Avoid hitting Bilibili again every time the detail page reopens.
const noActivityPv = new Set<string>();

const SCROLL_PREFIX = "arkstage-chapter-scroll:";
const COLLAPSED_PREFIX = "arkstage-chapter-collapsed:";
const RETURN_PREFIX = "arkstage-chapter-return:";

interface Props {
  book: Book;
  cachedStories: Set<string>;
  /** Story page-titles the user has opened in the player (read). */
  readStories: Set<string>;
  /** The last-watched story's page-title (tagged "上次观看" in the list). */
  lastWatched: string | null;
  /** Currently-selected story page-titles (shared across the detail view). */
  selected: Set<string>;
  /** Multi-select mode (checkboxes shown). Entered by long-pressing a story/chapter. */
  selectionMode: boolean;
  onBack: () => void;
  onPlay: (pageTitle: string) => void;
  /** Toggle one story's selection. */
  onToggleStory: (pageTitle: string) => void;
  /** Add or remove a batch of page-titles (whole chapter). */
  onSetMany: (pageTitles: string[], on: boolean) => void;
}

/**
 * Drill-in view for one book: a hero header plus its chapters, each collapsible
 * and listing its stories. Long-press a story or chapter to enter selection mode
 * (then the bottom bar drives download/delete); tap a story to read it. A leading
 * dot shows state: grey (not cached) / yellow (cached) / green (read).
 */
export default function ChapterDetail({
  book,
  cachedStories,
  readStories,
  lastWatched,
  selected,
  selectionMode,
  onBack,
  onPlay,
  onToggleStory,
  onSetMany,
}: Props) {
  const fallback = coverFallback();
  const { metadata, resolveArt } = useBookshelfMetadata();
  const [banner, setBanner] = useState<ResolvedArt | null>(null);
  useEffect(() => {
    let alive = true;
    void resolveArt("banners", book.coverKey).then((art) => {
      if (alive) setBanner(art);
    });
    return () => {
      alive = false;
    };
  }, [book.coverKey, metadata?.version, resolveArt]);
  const isCached = (pt: string) => cachedStories.has(cachedKey(pt));
  const isRead = (pt: string) => readStories.has(pt);

  const cachedCount = useMemo(
    () => book.pageTitles.filter((pt) => cachedStories.has(cachedKey(pt))).length,
    [book.pageTitles, cachedStories]
  );
  const readCount = useMemo(
    () => book.pageTitles.filter((pt) => readStories.has(pt)).length,
    [book.pageTitles, readStories]
  );

  // Flatten once so "continue" / "next unread" can jump across chapters.
  const flatStories = useMemo(
    () =>
      book.chapters.flatMap((ch, ci) =>
        ch.stories.map((story, si) => ({
          ...story,
          chapterName: ch.name,
          chapterIndex: ci,
          storyIndex: si,
        }))
      ),
    [book.chapters]
  );
  const lastStory = useMemo(
    () => flatStories.find((story) => story.page_title === lastWatched) ?? null,
    [flatStories, lastWatched]
  );
  const nextUnread = useMemo(
    () => flatStories.find((story) => !isRead(story.page_title)) ?? flatStories[0] ?? null,
    [flatStories, readStories]
  );

  // Start with the chapter that contains "last watched" (or the first unread
  // chapter) open; everything else collapsed. This turns a 4,000px wall into
  // two or three screenfuls on a phone while keeping the target one tap away.
  const initialCollapsed = useMemo(() => {
    const target = lastStory?.chapterIndex
      ?? nextUnread?.chapterIndex
      ?? 0;
    const next: Record<number, boolean> = {};
    book.chapters.forEach((_, index) => {
      if (index !== target) next[index] = true;
    });
    return next;
    // readStories is intentionally not a dependency: recomputing the initial
    // fold after every read would fight the user's manual expand/collapse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.coverKey, lastStory?.chapterIndex, nextUnread?.chapterIndex, book.chapters.length]);

  const scrollKey = `${SCROLL_PREFIX}${book.coverKey}`;
  const collapsedKey = `${COLLAPSED_PREFIX}${book.coverKey}`;
  const returnKey = `${RETURN_PREFIX}${book.coverKey}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [returning] = useState(() => {
    try {
      return sessionStorage.getItem(returnKey) === "1";
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>(() => {
    if (returning) {
      try {
        const raw = sessionStorage.getItem(collapsedKey);
        if (raw) return JSON.parse(raw) as Record<number, boolean>;
      } catch {
        // fall through to the normal initial fold
      }
    }
    return initialCollapsed;
  });
  const [showOpening, setShowOpening] = useState(false);
  const [biliKeyword, setBiliKeyword] = useState<string | null>(null);
  const [biliBvid, setBiliBvid] = useState<string | null>(null);
  const [autoExternal, setAutoExternal] = useState<ExternalOpening | null>(null);
  const opening = openingForBook(book.coverKey);
  const isMain = isMainStoryBook(book.coverKey);
  const curatedPvs = useMemo(() => pvListForBook(book.coverKey), [book.coverKey]);
  const curatedVideos = useMemo(
    () => curatedPvs.map((item) => ({ bvid: item.bvid, title: item.title, pv_type: item.type })),
    [curatedPvs]
  );
  const curatedExternal = externalOpeningForBook(book.coverKey);

  // All books get a Bilibili PV entry when one exists: activities use
  // 活动先导PV, main-story books use 概念PV. Local animations no longer suppress
  // the Bilibili entry. Unknown/new books are checked once with strict search.
  useEffect(() => {
    setAutoExternal(null);
    if (curatedPvs.length > 0) return;
    const kind = isMain ? "main" : "activity";
    const cacheKey = `${kind}:${book.coverKey}`;
    if (noActivityPv.has(cacheKey)) return;
    let cancelled = false;
    void invoke<{ bvid: string; pv_type: string }[]>("bilibili_pv_list", {
      keyword: book.coverKey,
      kind,
    })
      .then((list) => {
        if (!cancelled && list.length > 0 && list[0].bvid) {
          setAutoExternal({
            bookKey: book.coverKey,
            title: book.coverKey,
            bvid: list[0].bvid,
            kind,
            label: list[0].pv_type,
          });
        } else if (!cancelled) {
          noActivityPv.add(cacheKey);
        }
      })
      .catch(() => {
        noActivityPv.add(cacheKey);
      });
    return () => {
      cancelled = true;
    };
  }, [book.coverKey, isMain, curatedPvs]);

  const externalOpening = curatedExternal ?? autoExternal;

  useLayoutEffect(() => {
    if (!returning) return;
    const element = scrollRef.current;
    if (!element) return;
    let top = 0;
    try {
      top = Number(sessionStorage.getItem(scrollKey) ?? 0);
    } catch {
      top = 0;
    }
    const restore = () => {
      element.scrollTop = top;
    };
    restore();
    const frame = requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
    try {
      sessionStorage.removeItem(returnKey);
    } catch {
      // best-effort
    }
    return () => cancelAnimationFrame(frame);
  }, [returning, scrollKey, returnKey]);

  useEffect(() => {
    // On a return from the player, keep the exact chapter fold the user had
    // before entering the story; otherwise auto-fold around last/next unread.
    if (returning) return;
    setCollapsed(initialCollapsed);
  }, [initialCollapsed, returning]);

  const savePosition = () => {
    const element = scrollRef.current;
    if (!element) return;
    try {
      sessionStorage.setItem(scrollKey, String(element.scrollTop));
      sessionStorage.setItem(collapsedKey, JSON.stringify(collapsed));
      sessionStorage.setItem(returnKey, "1");
    } catch {
      // best-effort
    }
  };

  const playFromList = (pageTitle: string) => {
    savePosition();
    onPlay(pageTitle);
  };

  const allOpen = book.chapters.every((_, index) => !collapsed[index]);
  const toggleAll = () => {
    if (allOpen) {
      const next: Record<number, boolean> = {};
      book.chapters.forEach((_, index) => { next[index] = true; });
      setCollapsed(next);
    } else {
      setCollapsed({});
    }
  };
  const jumpToChapter = (index: number) => {
    setCollapsed((prev) => ({ ...prev, [index]: false }));
    requestAnimationFrame(() => {
      document.getElementById(`chapter-sec-${index}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const chapterState = (ch: StoryChapter): { all: boolean; some: boolean } => {
    const sel = ch.stories.filter((s) => selected.has(s.page_title)).length;
    return { all: sel === ch.stories.length && sel > 0, some: sel > 0 };
  };

  // Dot for one story: green=read, blue=downloaded, none otherwise (a single
  // story has no "partial", so no yellow).
  const storyDot = (pt: string) => (isRead(pt) ? "read" : isCached(pt) ? "all" : "");

  const readPct = book.storyCount > 0 ? Math.round((readCount / book.storyCount) * 100) : 0;
  const hasUnread = flatStories.some((story) => !isRead(story.page_title));

  return (
    <div
      className="chapter-detail"
      ref={scrollRef}
      onScroll={(event) => {
        try {
          sessionStorage.setItem(scrollKey, String(event.currentTarget.scrollTop));
        } catch {
          // best-effort
        }
      }}
    >
      <div className="detail-sticky">
        <button className="back-icon" onClick={onBack} aria-label="返回">
          ◀
        </button>
        <div className="detail-sticky-title">
          <strong>{book.coverKey}</strong>
          <span>已读 {readCount}/{book.storyCount}</span>
        </div>
        <button className="detail-expand" onClick={toggleAll}>
          {allOpen ? "收起" : "展开全部"}
        </button>
      </div>

      <div className={`detail-hero ${banner ? "has-banner" : ""}`} style={{ background: fallback.background }}>
        {banner && (
          <img
            className="hero-banner"
            src={banner.url}
            data-fallback={banner.fallbackUrl}
            onError={(event) => {
              const fallbackUrl = event.currentTarget.dataset.fallback;
              if (!fallbackUrl) {
                setBanner(null);
                return;
              }
              delete event.currentTarget.dataset.fallback;
              event.currentTarget.src = fallbackUrl;
            }}
            alt=""
            draggable={false}
          />
        )}
        <div className="hero-scrim" />
        <div className="hero-meta">
          <div className="hero-cat">{book.category}</div>
          <h1 className="hero-title">{book.coverKey}</h1>
          <div className="hero-sub">
            {book.chapters.length > 1 ? `${book.chapters.length} 章 · ` : ""}
            {book.storyCount} 节 · 已读 {readCount} · 已缓存 {cachedCount}
          </div>
          <div className="hero-progress" aria-hidden="true">
            <i style={{ width: `${readPct}%` }} />
          </div>
          <div className="hero-actions">
            {lastStory && (
              <button
                className="hero-action primary"
                onClick={() => playFromList(lastStory.page_title)}
              >
                继续上次
              </button>
            )}
            {nextUnread && (
              <button
                className="hero-action"
                onClick={() => playFromList(nextUnread.page_title)}
              >
                {hasUnread ? "下一未读" : "从头重读"}
              </button>
            )}
            {opening && (
              <button className="hero-action opening" onClick={() => setShowOpening(true)}>
                {opening.buttonLabel}
              </button>
            )}
            {externalOpening && (
              <button
                className="hero-action external"
                onClick={() => {
                  setBiliKeyword(externalOpening.title);
                  setBiliBvid(externalOpening.bvid);
                }}
              >
                {externalOpening.label}
              </button>
            )}
          </div>
        </div>
      </div>

      {book.chapters.length > 2 && (
        <div className="chapter-jump" aria-label="章节快速跳转">
          {book.chapters.map((ch, ci) => (
            <button
              key={ci}
              className="chapter-jump-chip"
              title={ch.name}
              onClick={() => jumpToChapter(ci)}
            >
              <b>{String(ci + 1).padStart(2, "0")}</b>
              <span>{ch.name}</span>
            </button>
          ))}
        </div>
      )}

      {showOpening && opening && (
        <ChapterOpening opening={opening} onClose={() => setShowOpening(false)} />
      )}

      {biliKeyword && (
        <BilibiliPlayer
          keyword={biliKeyword}
          bvid={biliBvid}
          kind={isMain ? "main" : "activity"}
          videos={curatedVideos}
          onClose={() => {
            setBiliKeyword(null);
            setBiliBvid(null);
          }}
        />
      )}

      <div className="detail-body">
        {book.chapters.map((ch, ci) => (
          <Chapter
            key={ci}
            index={ci}
            chapter={ch}
            open={!collapsed[ci]}
            onToggleOpen={() => setCollapsed((p) => ({ ...p, [ci]: !p[ci] }))}
            selected={selected}
            lastWatched={lastWatched}
            selectionMode={selectionMode}
            chapterState={chapterState(ch)}
            isCached={isCached}
            isRead={isRead}
            storyDot={storyDot}
            onPlay={playFromList}
            onToggleStory={onToggleStory}
            onSetMany={onSetMany}
          />
        ))}
      </div>
    </div>
  );
}

function Chapter({
  index,
  chapter: ch,
  open,
  onToggleOpen,
  selected,
  lastWatched,
  selectionMode,
  chapterState: st,
  isCached,
  isRead,
  storyDot,
  onPlay,
  onToggleStory,
  onSetMany,
}: {
  index: number;
  chapter: StoryChapter;
  open: boolean;
  onToggleOpen: () => void;
  selected: Set<string>;
  lastWatched: string | null;
  selectionMode: boolean;
  chapterState: { all: boolean; some: boolean };
  isCached: (pt: string) => boolean;
  isRead: (pt: string) => boolean;
  storyDot: (pt: string) => string;
  onPlay: (pt: string) => void;
  onToggleStory: (pt: string) => void;
  onSetMany: (pts: string[], on: boolean) => void;
}) {
  const titles = ch.stories.map((s) => s.page_title);
  const readCount = titles.filter((pt) => isRead(pt)).length;
  const chRead = titles.length > 0 && readCount === titles.length;
  const cachedCount = titles.filter((pt) => isCached(pt)).length;
  // Chapter dot: green=all read, blue=all downloaded, yellow=partly downloaded, none otherwise.
  const chDot = chRead
    ? "read"
    : cachedCount === titles.length && titles.length > 0
      ? "all"
      : cachedCount > 0
        ? "partial"
        : "";

  // Long-press the chapter title → select the whole chapter; tap → collapse.
  const headPress = useLongPress(() => onSetMany(titles, true), onToggleOpen);

  const readPct = titles.length > 0 ? Math.round((readCount / titles.length) * 100) : 0;

  return (
    <div className={`detail-chapter ${chRead ? "read" : ""}`} id={`chapter-sec-${index}`}>
      <div className="dc-head">
        {selectionMode && (
          <button
            className={`dc-check ${st.all ? "on" : ""} ${st.some && !st.all ? "partial" : ""}`}
            title={st.all ? "取消选择本章" : "选择本章"}
            onClick={(e) => {
              e.stopPropagation();
              onSetMany(titles, !st.all);
            }}
          >
            {st.all ? "✓" : st.some ? "–" : ""}
          </button>
        )}
        <span className="dc-index">{String(index + 1).padStart(2, "0")}</span>
        <span className={`dc-dot ${chDot}`} />
        <button className="dc-title" {...headPress}>
          <span className={`arrow ${open ? "open" : ""}`}>▶</span>
          <span className="dc-name">{ch.name}</span>
          <span className="dc-count">
            {readCount > 0 && !chRead ? `已读 ${readCount}/${ch.stories.length}` : `${ch.stories.length} 节`}
          </span>
          <span className="dc-mini-bar" aria-hidden="true">
            <i style={{ width: `${readPct}%` }} />
          </span>
        </button>
      </div>

      {open && (
        <div className="dc-stories">
          {ch.stories.map((s, si) => (
            <Story
              key={si}
              index={si}
              title={s.title}
              pageTitle={s.page_title}
              on={selected.has(s.page_title)}
              dot={storyDot(s.page_title)}
              isLast={s.page_title === lastWatched}
              selectionMode={selectionMode}
              onPlay={onPlay}
              onToggleStory={onToggleStory}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Story({
  index,
  title,
  pageTitle,
  on,
  dot,
  isLast,
  selectionMode,
  onPlay,
  onToggleStory,
}: {
  index: number;
  title: string;
  pageTitle: string;
  on: boolean;
  dot: string;
  isLast: boolean;
  selectionMode: boolean;
  onPlay: (pt: string) => void;
  onToggleStory: (pt: string) => void;
}) {
  // Long-press → select; tap → toggle (in selection mode) or read.
  const press = useLongPress(
    () => onToggleStory(pageTitle),
    () => (selectionMode ? onToggleStory(pageTitle) : onPlay(pageTitle))
  );
  return (
    <div className={`dc-story ${on ? "sel" : ""} ${dot === "read" ? "read" : ""}`}>
      {selectionMode && (
        <button
          className={`dc-scheck ${on ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStory(pageTitle);
          }}
          title={on ? "取消选择" : "选择"}
        >
          {on ? "✓" : ""}
        </button>
      )}
      <span className="dc-sindex">{String(index + 1).padStart(2, "0")}</span>
      <span className={`dc-dot ${dot}`} />
      <span className="dc-stitle" title={pageTitle} {...press}>
        {title}
      </span>
      {isLast && <span className="dc-last-tag">上次观看</span>}
    </div>
  );
}
