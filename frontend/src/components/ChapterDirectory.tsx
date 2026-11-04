import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Book, Shelf } from "../lib/bookshelf";
import { cachedKey } from "../lib/bookshelf";
import { coverFallback } from "../lib/cover";
import { useBookshelfMetadata, type ResolvedArt } from "../lib/BookshelfMetadataContext";

type DirFilter = "all" | "unread" | "cached" | "main";

const DIR_FILTER_KEY = "arkstage-directory-filter";
const DIR_CATEGORY_KEY = "arkstage-directory-category";
const DIR_SCROLL_KEY = "arkstage-directory-scroll";

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

interface Props {
  shelves: Shelf[];
  cachedStories: Set<string>;
  readStories: Set<string>;
  lastWatched: string | null;
  onOpenBook: (book: Book) => void;
  onPlay: (pageTitle: string) => void;
}

/**
 * Flat, phone-first chapter directory. The cover shelf is great for browsing,
 * but on a 360px screen a long book is many swipes away. This view keeps every
 * book in one vertical list, adds read/cache progress, and offers filters that
 * answer the two real questions: "what should I read next?" and "what is already
 * downloaded?".
 */
export default function ChapterDirectory({
  shelves,
  cachedStories,
  readStories,
  lastWatched,
  onOpenBook,
  onPlay,
}: Props) {
  const [filter, setFilter] = useState<DirFilter>(() => {
    const stored = readStored(DIR_FILTER_KEY);
    return stored === "unread" || stored === "cached" || stored === "main" ? stored : "all";
  });
  const [category, setCategory] = useState<string>(() => readStored(DIR_CATEGORY_KEY) ?? "全部");
  const scroller = useRef<HTMLDivElement>(null);

  const allBooks = useMemo(
    () => shelves.flatMap((shelf) => shelf.books.map((book) => ({ book, category: shelf.category }))),
    [shelves]
  );

  const lastBook = useMemo(() => {
    if (!lastWatched) return null;
    return allBooks.find(({ book }) => book.pageTitles.includes(lastWatched)) ?? null;
  }, [allBooks, lastWatched]);

  const readCountOf = (book: Book) => book.pageTitles.filter((pt) => readStories.has(pt)).length;
  const cachedCountOf = (book: Book) =>
    book.pageTitles.filter((pt) => cachedStories.has(cachedKey(pt))).length;

  const visible = useMemo(() => {
    let books = allBooks;
    if (filter === "unread") {
      books = books.filter(({ book }) => readCountOf(book) < book.storyCount);
    } else if (filter === "cached") {
      books = books.filter(({ book }) => cachedCountOf(book) > 0);
    } else if (filter === "main") {
      books = books.filter(({ category: cat }) => cat === "为了明日");
    }
    if (category !== "全部") books = books.filter(({ category: cat }) => cat === category);
    return books;
  }, [allBooks, category, cachedStories, filter, readStories]);

  // Group in original shelf order so the directory still reads like the game's
  // StoryLine, not an alphabetised database.
  const grouped = useMemo(() => {
    const map = new Map<string, { book: Book; index: number }[]>();
    let index = 0;
    for (const item of visible) {
      const list = map.get(item.category) ?? [];
      list.push({ book: item.book, index: index++ });
      map.set(item.category, list);
    }
    return [...map.entries()];
  }, [visible]);

  const categories = useMemo(() => ["全部", ...shelves.map((s) => s.category)], [shelves]);

  useEffect(() => {
    store(DIR_FILTER_KEY, filter);
  }, [filter]);
  useEffect(() => {
    store(DIR_CATEGORY_KEY, category);
    if (category !== "全部" && !categories.includes(category)) {
      setCategory("全部");
    }
  }, [categories, category]);

  // Coming back from a book or the player remounts this list; restore the
  // previous scroll position and let a second frame settle lazy cover layout.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const top = Number(readStored(DIR_SCROLL_KEY) ?? 0);
    const restore = () => {
      element.scrollTop = top;
    };
    restore();
    const frame = requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const lastStoryTitle = useMemo(() => {
    if (!lastWatched) return null;
    for (const { book } of allBooks) {
      for (const chapter of book.chapters) {
        const story = chapter.stories.find((s) => s.page_title === lastWatched);
        if (story) return { title: story.title, chapter: chapter.name, book: book.coverKey };
      }
    }
    return null;
  }, [allBooks, lastWatched]);

  const selectCategory = (cat: string) => {
    setCategory(cat);
    store(DIR_SCROLL_KEY, "0");
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div
      className="chapter-directory"
      ref={scroller}
      onScroll={(event) => store(DIR_SCROLL_KEY, String(event.currentTarget.scrollTop))}
    >
      {lastWatched && lastStoryTitle && (
        <div className="dir-continue">
          <div className="dir-continue-label">上次看到</div>
          <div className="dir-continue-main">
            <strong>{lastStoryTitle.title}</strong>
            <span>{lastStoryTitle.book} · {lastStoryTitle.chapter}</span>
          </div>
          <button className="dir-continue-btn" onClick={() => onPlay(lastWatched)}>
            继续
          </button>
        </div>
      )}

      <div className="dir-controls">
        <div className="dir-filters" role="tablist" aria-label="目录筛选">
          {([
            ["all", "全部"],
            ["unread", "未读"],
            ["cached", "已缓存"],
            ["main", "主线"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              className={`dir-filter ${filter === value ? "on" : ""}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="dir-categories">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`dir-cat ${category === cat ? "on" : ""}`}
              onClick={() => selectCategory(cat === category && cat !== "全部" ? "全部" : cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {grouped.length === 0 && (
        <div className="dir-empty">
          {filter === "unread" ? "这个范围内没有未读剧情了。" : "没有找到匹配的剧情。"}
        </div>
      )}

      {grouped.map(([cat, items]) => (
        <section key={cat} id={`dir-sec-${encodeURIComponent(cat)}`} className="dir-section">
          <div className="dir-section-head">
            <h2>{cat}</h2>
            <span>{items.length} 本</span>
          </div>
          <div className="dir-list">
            {items.map(({ book, index }) => (
              <DirectoryRow
                key={`${cat}-${book.coverKey}`}
                book={book}
                index={index}
                readCount={readCountOf(book)}
                cachedCount={cachedCountOf(book)}
                isLast={!!lastBook && lastBook.book.coverKey === book.coverKey}
                onOpen={() => onOpenBook(book)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DirectoryRow({
  book,
  index,
  readCount,
  cachedCount,
  isLast,
  onOpen,
}: {
  book: Book;
  index: number;
  readCount: number;
  cachedCount: number;
  isLast: boolean;
  onOpen: () => void;
}) {
  const fallback = coverFallback();
  const { metadata, resolveArt } = useBookshelfMetadata();
  const [art, setArt] = useState<ResolvedArt | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setCoverFailed(false);
    void resolveArt("covers", book.coverKey).then((next) => {
      if (alive) setArt(next);
    });
    return () => {
      alive = false;
    };
  }, [book.coverKey, metadata?.version, resolveArt]);

  const total = book.storyCount || 1;
  const readPct = Math.round((readCount / total) * 100);
  const cachedPct = Math.round((cachedCount / total) * 100);

  return (
    <div
      className={`dir-row ${isLast ? "is-last" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="dir-index">{String(index + 1).padStart(2, "0")}</span>
      <span className="dir-thumb" style={{ background: fallback.background }}>
        {art && !coverFailed ? (
          <img
            src={art.url}
            data-fallback={art.fallbackUrl}
            loading="lazy"
            alt=""
            draggable={false}
            onError={(event) => {
              const fb = event.currentTarget.dataset.fallback;
              if (!fb) {
                setCoverFailed(true);
                return;
              }
              delete event.currentTarget.dataset.fallback;
              event.currentTarget.src = fb;
            }}
          />
        ) : (
          <span className="dir-thumb-letter">{book.coverKey.slice(0, 1)}</span>
        )}
      </span>
      <span className="dir-main">
        <span className="dir-title-line">
          <span className="dir-title">{book.coverKey}</span>
          {isLast && <span className="dir-last">上次</span>}
        </span>
        <span className="dir-sub">
          {book.chapters.length > 1 ? `${book.chapters.length} 章 · ` : ""}
          {book.storyCount} 节
          {cachedCount > 0 ? ` · 已缓存 ${cachedCount}` : ""}
        </span>
        <span className="dir-bars" aria-hidden="true">
          <span className="dir-bar"><i className="read" style={{ width: `${readPct}%` }} /></span>
          <span className="dir-bar"><i className="cached" style={{ width: `${cachedPct}%` }} /></span>
        </span>
      </span>
      <span className="dir-progress-text">
        <span className="dir-progress-num"><b>{readCount}</b>/{book.storyCount}</span>
        <small>已读</small>
      </span>
      <span className="dir-chevron" aria-hidden="true">›</span>
    </div>
  );
}
