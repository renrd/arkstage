import { useMemo, useState } from "react";
import type { Book, Shelf } from "../lib/bookshelf";
import { cachedKey } from "../lib/bookshelf";
import { READING_TIMELINE, timelineLabel, type TimelineEntry } from "../lib/readingTimeline";
import { openingForBook } from "../lib/chapterOpenings";

interface Props {
  shelves: Shelf[];
  cachedStories: Set<string>;
  readStories: Set<string>;
  lastWatched: string | null;
  query?: string;
  onOpenBook: (book: Book) => void;
  onPlay: (pageTitle: string) => void;
}

/**
 * Game-like recommended reading timeline: the main story is the spine, and the
 * events that pay off around a main chapter are inserted right after it. This is
 * deliberately a recommendation, not a claim of exact in-world chronology.
 */
export default function ReadingTimeline({
  shelves,
  cachedStories,
  readStories,
  lastWatched,
  query = "",
  onOpenBook,
  onPlay,
}: Props) {
  const [showOptional, setShowOptional] = useState(false);

  const books = useMemo(() => shelves.flatMap((shelf) => shelf.books), [shelves]);
  const bookFor = (entry: TimelineEntry): Book | undefined =>
    books.find((book) => book.coverKey === entry.title)
    ?? books.find((book) =>
      book.chapters.some(
        (chapter) => chapter.name === entry.title || chapter.activity_name === entry.title
      )
    );

  const lastBook = useMemo(() => {
    if (!lastWatched) return null;
    return books.find((book) => book.pageTitles.includes(lastWatched)) ?? null;
  }, [books, lastWatched]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return READING_TIMELINE.filter((entry) => {
      if (!showOptional && entry.kind === "optional") return false;
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q)
        || entry.note.toLowerCase().includes(q)
        || entry.after.toLowerCase().includes(q)
      );
    });
  }, [query, showOptional]);

  const lastEntry = useMemo(() => {
    if (!lastBook) return null;
    return READING_TIMELINE.find((entry) => bookFor(entry)?.coverKey === lastBook.coverKey) ?? null;
  }, [lastBook, books]);

  return (
    <div className="reading-timeline">
      <div className="tl-head">
        <div className="tl-head-copy">
          <div className="tl-kicker">RECOMMENDED ORDER</div>
          <h2>主线 × 强相关活动</h2>
          <p>主线是骨架；蓝标活动建议插在对应主线之后读。灰标是可选的地区线，不影响主线理解。</p>
        </div>
        <button
          className={`tl-toggle ${showOptional ? "on" : ""}`}
          aria-pressed={showOptional}
          onClick={() => setShowOptional((value) => !value)}
        >
          {showOptional ? "隐藏可选支线" : "显示可选支线"}
        </button>
      </div>

      {lastEntry && lastWatched && (
        <div className="tl-continue">
          <div>
            <span>上次读到</span>
            <strong>{lastEntry.title}</strong>
          </div>
          <button onClick={() => onPlay(lastWatched)}>继续</button>
        </div>
      )}

      <div className="tl-list">
        {visible.map((entry) => {
          const book = bookFor(entry);
          const readCount = book
            ? book.pageTitles.filter((title) => readStories.has(title)).length
            : 0;
          const cachedCount = book
            ? book.pageTitles.filter((title) => cachedStories.has(cachedKey(title))).length
            : 0;
          const total = book?.storyCount ?? 0;
          const percent = total > 0 ? Math.round((readCount / total) * 100) : 0;
          const isLast = !!book && book.coverKey === lastBook?.coverKey;
          const opening = book ? openingForBook(book.coverKey) : null;
          const afterLabel = entry.after === "起点"
            ? "起点"
            : entry.after.startsWith("第") ? `${entry.after}后` : entry.after;

          return (
            <article
              id={`tl-${entry.id}`}
              key={entry.id}
              className={`tl-item kind-${entry.kind} ${isLast ? "is-last" : ""}`}
            >
              <div className="tl-rail" aria-hidden="true">
                <span className="tl-dot" />
              </div>
              <div
                className={`tl-card ${book ? "" : "missing"}`}
                role={book ? "button" : undefined}
                tabIndex={book ? 0 : -1}
                onClick={() => book && onOpenBook(book)}
                onKeyDown={(event) => {
                  if (!book) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenBook(book);
                  }
                }}
              >
                <div className="tl-meta">
                  <span className="tl-badge">{timelineLabel(entry.kind)}</span>
                  <span className="tl-after">{afterLabel}</span>
                  {opening && (
                    <span className="tl-opening">
                      {opening.buttonLabel === "开场动画" ? "开场" : opening.buttonLabel === "结尾动画" ? "结尾" : "动画"}
                    </span>
                  )}
                  {isLast && <span className="tl-here">上次</span>}
                </div>
                <h3>{entry.title}</h3>
                <p className="tl-note">{entry.note}</p>
                <div className="tl-progress">
                  <span className="tl-bar"><i style={{ width: `${percent}%` }} /></span>
                  <span className="tl-count">
                    {book ? `${readCount}/${total} 已读` : "书架中未找到"}
                    {book && cachedCount > 0 ? ` · 缓存 ${cachedCount}` : ""}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {visible.length === 0 && <div className="tl-empty">没有匹配的时间线节点。</div>}

      <p className="tl-footnote">
        这是社区向推荐顺序，不是官方强制时间线。活动剧情经常跨时间、跨地区，圆号/年份并不代表阅读优先级；
        如果只想补主线，按金色节点读即可。
      </p>
    </div>
  );
}
