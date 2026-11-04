import { useMemo, useState } from "react";
import type { StoryIndex } from "../hooks/useStoryIndex";
import { useDownload } from "../lib/DownloadContext";
import { setDownloadSettings } from "../lib/predownload";
import { allOpeningUrls, mainOpeningUrls } from "../lib/chapterOpenings";
import { completeFirstRun, type FirstRunChoice } from "../lib/firstRun";

interface Props {
  index: StoryIndex;
  onDone: () => void;
}

/**
 * First-launch setup. Android cannot run app code while the APK is being
 * installed, so the next best thing is to ask once, immediately after the first
 * launch, and start the cache in the background while the user browses.
 */
export default function FirstRunWizard({ index, onDone }: Props) {
  const { start, busy } = useDownload();
  const [choice, setChoice] = useState<FirstRunChoice>("main");
  const [fast, setFast] = useState(true);

  const { mainTitles, allTitles } = useMemo(() => {
    const all = index.categories.flatMap((category) =>
      category.chapters.flatMap((chapter) => chapter.stories.map((story) => story.page_title))
    );
    const mainCategory =
      index.categories.find((category) => category.name === "为了明日")
      ?? index.categories.find((category) => category.name === "主线")
      ?? index.categories.find((category) => category.name.includes("主线"))
      ?? index.categories[0];
    const main = mainCategory
      ? mainCategory.chapters.flatMap((chapter) => chapter.stories.map((story) => story.page_title))
      : all;
    return {
      mainTitles: [...new Set(main)],
      allTitles: [...new Set(all)],
    };
  }, [index]);

  const titles = choice === "all" ? allTitles : choice === "main" ? mainTitles : [];
  const count = titles.length;

  const begin = async () => {
    completeFirstRun(choice);
    if (choice === "none") {
      onDone();
      return;
    }
    if (fast) {
      // Full-library caching is dominated by request latency; a wider pool is
      // the single biggest win. The user can lower it again in Settings.
      await setDownloadSettings({ concurrency: 24, rateLimitBps: 0 }).catch(() => {});
    }
    onDone();
    // Do not await: the global DownloadBar shows progress and the user can keep
    // browsing while the foreground service downloads in the background.
    // Chapter-entry movies are not part of the AVG manifest, so seed them too.
    // Main-only includes 9–13; the full preset also grabs event endings/collabs.
    void start(titles, choice === "all" ? allOpeningUrls(true) : mainOpeningUrls());
  };

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div className="setup-card">
        <div className="setup-kicker">FIRST LAUNCH SETUP</div>
        <h2 id="setup-title">先把剧情缓存好，再开始读</h2>
        <p className="setup-lead">
          APK 安装过程本身不能执行下载；这里是首次启动后的一键缓存。选好范围后会在后台开始，
          你可以同时逛书架、看已缓存的主线，下载会继续。
        </p>

        <div className="setup-options">
          <button
            className={`setup-option ${choice === "main" ? "on" : ""}`}
            onClick={() => setChoice("main")}
            aria-pressed={choice === "main"}
          >
            <span className="setup-radio" />
            <span className="setup-option-main">
              <strong>主线优先 <em>推荐</em></strong>
              <small>「为了明日」全部 {mainTitles.length} 节，先保证主线能连续读</small>
            </span>
            <span className="setup-size">较快</span>
          </button>

          <button
            className={`setup-option ${choice === "all" ? "on" : ""}`}
            onClick={() => setChoice("all")}
            aria-pressed={choice === "all"}
          >
            <span className="setup-radio" />
            <span className="setup-option-main">
              <strong>全部剧情</strong>
              <small>全部 {allTitles.length} 节（主线 + 活动 + 密录等），约 4–5 GB</small>
            </span>
            <span className="setup-size">最完整</span>
          </button>

          <button
            className={`setup-option ${choice === "none" ? "on" : ""}`}
            onClick={() => setChoice("none")}
            aria-pressed={choice === "none"}
          >
            <span className="setup-radio" />
            <span className="setup-option-main">
              <strong>先不缓存</strong>
              <small>只下载当前打开的那一节，之后可在书架批量补</small>
            </span>
            <span className="setup-size">最省空间</span>
          </button>
        </div>

        <label className="setup-fast">
          <input
            type="checkbox"
            checked={fast}
            onChange={(event) => setFast(event.target.checked)}
          />
          <span>
            全速模式：24 并发、不限速
            <small>首次全量缓存明显更快；如果源站限流可回到设置调低</small>
          </span>
        </label>

        <div className="setup-actions">
          <button className="setup-later" onClick={() => { completeFirstRun("none"); onDone(); }}>
            以后再说
          </button>
          <button className="setup-start" onClick={() => void begin()} disabled={busy}>
            {busy ? "已有下载任务…" : count > 0 ? `开始缓存 ${count} 节` : "进入书架"}
          </button>
        </div>

        <p className="setup-foot">
          首次启动仍需联网获取剧情目录与演出引擎。下载任务会显示在底部；App 退到后台后，
          Android 前台服务会继续下载。缓存可以在书架长按多选、或设置页里暂停/继续。
        </p>
      </div>
    </div>
  );
}
