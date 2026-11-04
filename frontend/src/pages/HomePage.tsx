import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, type UpdateInfo } from "../lib/version";
import { openExternal } from "../lib/external";
import { useStoryIndex } from "../hooks/useStoryIndex";
import { getLastWatched } from "../lib/readState";
import { hasCompletedFirstRun } from "../lib/firstRun";
import FirstRunWizard from "../components/FirstRunWizard";

export default function HomePage() {
  const navigate = useNavigate();
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [lastWatched, setLastWatched] = useState<string | null>(() => getLastWatched());
  const [showSetup, setShowSetup] = useState(() => !hasCompletedFirstRun());
  const { index } = useStoryIndex();

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    checkForUpdate()
      .then((u) => {
        if (u?.hasUpdate) setUpdate(u);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const refresh = () => setLastWatched(getLastWatched());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const lastInfo = useMemo(() => {
    if (!index || !lastWatched) return null;
    for (const category of index.categories) {
      for (const chapter of category.chapters) {
        const story = chapter.stories.find((item) => item.page_title === lastWatched);
        if (story) {
          return { title: story.title, chapter: chapter.name, category: category.name };
        }
      }
    }
    return null;
  }, [index, lastWatched]);

  return (
    <div className="home-page">
      <img className="home-logo" src="/logo.png" alt="方舟剧场" />
      <h1 className="home-title">方舟剧场</h1>
      <p className="home-tagline">明日方舟剧情 · 离线演出回放</p>

      <button className="home-help" onClick={() => navigate("/help")}>
        使用说明
      </button>

      {lastInfo && lastWatched && (
        <button
          className="home-continue"
          onClick={() => navigate(`/play/${encodeURIComponent(lastWatched)}`)}
        >
          <span className="home-continue-kicker">继续上次阅读</span>
          <strong>{lastInfo.title}</strong>
          <span className="home-continue-meta">
            {lastInfo.category} · {lastInfo.chapter}
          </span>
          <span className="home-continue-arrow" aria-hidden="true">›</span>
        </button>
      )}

      <div className="home-actions">
        <button className="btn-primary" onClick={() => navigate("/browse")}>
          浏览剧情
        </button>
        <button className="nav-btn" onClick={() => navigate("/browse?view=dir")}>
          剧情目录
        </button>
        <button className="nav-btn" onClick={() => navigate("/browse?view=timeline")}>
          推荐顺序
        </button>
        <button className="nav-btn" onClick={() => setShowSetup(true)}>
          缓存剧情
        </button>
        <button className="nav-btn" onClick={() => navigate("/settings")}>
          设置
        </button>
      </div>

      {update ? (
        <button
          className="home-version has-update"
          onClick={() => openExternal(update.url)}
          title={`点击前往 ${update.channel === "jsd" ? "jsDelivr 检测到的" : "GitHub"} 发布页下载 v${update.latest}`}
        >
          v{version} · <span className="blink">检测到更新 v{update.latest} ›</span>
        </button>
      ) : (
        <span className="home-version">v{version || "…"}</span>
      )}

      {showSetup && index && (
        <FirstRunWizard index={index} onDone={() => setShowSetup(false)} />
      )}
    </div>
  );
}
