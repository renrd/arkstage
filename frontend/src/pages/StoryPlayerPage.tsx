import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { bootEngineInFrame } from "../lib/engineBoot";
import { loadStoryRuntime } from "../lib/predownload";
import { setReading } from "../lib/keepalive";
import { useCompression } from "../lib/CompressionContext";
import {
  clearSavedLine,
  getSavedLine,
  markRead,
  saveLine,
  setLastWatched,
  type SavedLine,
} from "../lib/readState";
import { setLandscape } from "../lib/orientation";
import { setImmersive } from "../lib/immersive";
import type { PlayerController } from "../lib/modernEngine";
import PlayerHUD from "../components/PlayerHUD";
import { playbackCheckpoint, pushLog } from "../lib/debugLog";
import { buildTranscript } from "../lib/playerTranscript";
import { reportLoading, useLoadingProgress } from "../lib/loadingProgress";
import { useStoryIndex } from "../hooks/useStoryIndex";
import { buildShelves } from "../lib/bookshelf";

/**
 * Story player page — loads the ORIGINAL PRTS ScenarioSimulator engine via bootEngine().
 * All CDN requests are proxied through the prts-cdn:// custom protocol (offline-first).
 */

export default function StoryPlayerPage() {
  const { pageTitle } = useParams<{ pageTitle: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("正在加载...");
  const progress = useLoadingProgress();
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const controllerRef = useRef<PlayerController | null>(null);
  const [controller, setController] = useState<PlayerController | null>(null);
  const [storyScript, setStoryScript] = useState("");
  const [savedLine, setSavedLine] = useState<SavedLine | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [resumeDone, setResumeDone] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeStatus, setResumeStatus] = useState<string | null>(null);
  const seekCancelRef = useRef<(() => void) | null>(null);
  const resumeSettledRef = useRef(false);

  const decodedTitle = pageTitle ? decodeURIComponent(pageTitle) : "";
  const { busy: compressionBusy } = useCompression();
  const { index: storyIndex } = useStoryIndex();

  // Next page in the same book, then the next book in the same shelf. This is
  // the order shown by the directory, not the curated timeline, so "下一节"
  // keeps following the chapter the reader actually opened.
  const nextStory = useMemo(() => {
    if (!storyIndex || !decodedTitle) return null;
    const shelves = buildShelves(storyIndex);
    for (const shelf of shelves) {
      const bookIndex = shelf.books.findIndex((book) => book.pageTitles.includes(decodedTitle));
      if (bookIndex < 0) continue;
      const book = shelf.books[bookIndex];
      const entryOf = (target: (typeof shelf.books)[number], pageTitle: string) => {
        for (const chapter of target.chapters) {
          for (const story of chapter.stories) {
            if (story.page_title === pageTitle) {
              return { pageTitle, title: story.title, chapter: chapter.name };
            }
          }
        }
        return null;
      };
      const current = book.pageTitles.indexOf(decodedTitle);
      if (current >= 0 && current + 1 < book.pageTitles.length) {
        return entryOf(book, book.pageTitles[current + 1]);
      }
      for (const following of shelf.books.slice(bookIndex + 1)) {
        if (!following.pageTitles.length) continue;
        const first = entryOf(following, following.pageTitles[0]);
        if (first) return first;
      }
      return null;
    }
    return null;
  }, [storyIndex, decodedTitle]);

  const goToNextStory = () => {
    if (!nextStory) return;
    // Replace, don't push: otherwise "退出" from the next section pops back to
    // the section that just ended. The history entry below the player must stay
    // the chapter detail the reader originally came from.
    navigate(`/play/${encodeURIComponent(nextStory.pageTitle)}`, { replace: true });
  };


  // Safety net: if a compression batch is active (e.g. the app restarted onto a
  // restored /play route while the batch resumes), bounce out of the reader —
  // reading would fetch+write media the batch is concurrently rewriting.
  useEffect(() => {
    if (compressionBusy) navigate("/browse", { replace: true });
  }, [compressionBusy, navigate]);

  // Drive the Android keep-alive notification's "reading a story" state.
  useEffect(() => {
    setReading(true);
    return () => setReading(false);
  }, []);

  // Record this as the "last watched" story on entry; only mark it READ after
  // 30s in the reader (so merely peeking in doesn't count). Leaving early cancels.
  useEffect(() => {
    if (!decodedTitle) return;
    setLastWatched(decodedTitle);
    const t = setTimeout(() => markRead(decodedTitle), 30_000);
    return () => clearTimeout(t);
  }, [decodedTitle]);

  // The player is the ONLY screen forced to landscape AND the only one that hides
  // the system bars (immersive); both are restored on leave. (No-op off Android.)
  useEffect(() => {
    setLandscape(true);
    setImmersive(true);
    return () => {
      setLandscape(false);
      setImmersive(false);
    };
  }, []);

  useEffect(() => {
    if (!decodedTitle || !containerRef.current) return;

    let cancelled = false;
    const container = containerRef.current;
    setLoading(true);
    setError(null);
    setSyncWarning(null);
    setController(null);
    setSavedLine(null);
    setResumeChecked(false);
    setResumeDone(false);
    setResumeBusy(false);
    setResumeStatus(null);

    (async () => {
      try {
        // Script + engine/data tables come from the same fresh PRTS response. If
        // refresh fails, a validated last-known-good snapshot is retained visibly.
        setStatus(`正在同步剧情与演出引擎: ${decodedTitle}...`);
        const runtime = await loadStoryRuntime(decodedTitle);
        setStoryScript(runtime.story.script);
        if (runtime.source !== "live") {
          setSyncWarning("PRTS 同步失败，当前使用上次验证成功的离线快照；建议联网后重新进入。\n" + (runtime.warning || ""));
        }
        if (cancelled) return;

        // === Step 3: Boot the engine inside an isolated iframe realm ===
        setStatus("正在初始化播放器...");
        reportLoading({ phase: "initialize", message: "正在初始化播放器…" });
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:#000;";
        container.innerHTML = "";
        container.appendChild(iframe);
        let boot;
        try {
          boot = await bootEngineInFrame({
            iframe,
            bundle: runtime.bundle,
            script: runtime.story.script,
            title: decodedTitle,
            mode: "play",
            isCancelled: () => cancelled,
            onStatus: (message) => { setStatus(message); if (!runtime.bundle.module_engine) reportLoading({ phase: "initialize", message }); },
            onFatal: setError,
          });
        } catch (candidateError) {
          if (!runtime.fallback || cancelled) throw candidateError;
          setSyncWarning(
            `PRTS 最新演出引擎启动失败，已自动切换到上一可用版本。\n${candidateError instanceof Error ? candidateError.message : String(candidateError)}`
          );
          iframe.remove();
          const fallbackFrame = document.createElement("iframe");
          fallbackFrame.style.cssText = "width:100%;height:100%;border:0;display:block;background:#000;";
          container.appendChild(fallbackFrame);
          boot = await bootEngineInFrame({
            iframe: fallbackFrame,
            bundle: runtime.fallback.bundle,
            script: runtime.fallback.story.script,
            title: decodedTitle,
            mode: "play",
            isCancelled: () => cancelled,
            onStatus: (message) => { setStatus(message); if (!runtime.fallback!.bundle.module_engine) reportLoading({ phase: "initialize", message }); },
            onFatal: setError,
          });
          setStoryScript(runtime.fallback.story.script);
        }

        if (boot.audit?.missing.length) {
          setSyncWarning(`演出资源表校验发现 ${boot.audit.missing.length} 项缺失：\n${boot.audit.missing.slice(0, 8).join("\n")}`);
        }

        if (cancelled) { boot.controller?.dispose(); return; }
        controllerRef.current = boot.controller ?? null;
        setController(boot.controller ?? null);

        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          pushLog("error", "[playback] initialization failed:", e);
          await playbackCheckpoint(decodedTitle, "failed", String(e));
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controllerRef.current?.dispose();
      controllerRef.current = null;
      void playbackCheckpoint(decodedTitle, "cancelled");
      // Removing the iframe disposes the whole engine realm (timers, audio, globals).
      try {
        container
          .querySelector("iframe")
          ?.contentDocument?.querySelectorAll("#sys_audio audio")
          .forEach((el) => (el as HTMLAudioElement).pause());
      } catch {
        // ignore cross-realm access errors
      }
      container.innerHTML = "";
    };
  }, [decodedTitle]);

  // Once the engine is ready, look up the line checkpoint. Showing the prompt
  // (instead of auto-resuming) avoids surprising an auto-play user and lets them
  // deliberately restart.
  useEffect(() => {
    if (!controller || resumeChecked) return;
    setSavedLine(getSavedLine(decodedTitle));
    setResumeChecked(true);
  }, [controller, decodedTitle, resumeChecked]);

  // displayedLineIndex is already the engine's exact source line. Do not remap
  // it through buildTranscript: that mapped the saved line to the previous
  // visible text line and made the seek land one sentence early.
  const resumeTarget = savedLine ? savedLine.lineIndex : 0;

  const resumePreview = useMemo(() => {
    if (!savedLine || !storyScript) return null;
    const entries = buildTranscript(storyScript, savedLine.lineIndex);
    return entries.length ? entries[entries.length - 1] : null;
  }, [savedLine, storyScript]);

  // Persist the displayed line on a short interval plus on background/exit.
  // localStorage is synchronous and tiny; 1.2s is frequent enough that a kill
  // loses at most a sentence, while not writing on every 80ms frame.
  useEffect(() => {
    if (!controller) return;
    if (savedLine && !resumeDone) return;
    const persist = () => {
      try {
        if (controller.state().state === "finished") {
          clearSavedLine(decodedTitle);
          // Once this section is finished, history/continue should point at the
          // next section, not the one that just ended. If there is no next
          // section, leave the current one as the last watched.
          if (nextStory) setLastWatched(nextStory.pageTitle);
          return;
        }
        const position = controller.getPosition();
        if (position.lineIndex >= 0) {
          saveLine(decodedTitle, position.lineIndex, position.selections);
        }
      } catch {
        /* checkpoint is best-effort */
      }
    };
    const timer = setInterval(persist, 1200);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", persist);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, [controller, decodedTitle, nextStory, resumeDone, savedLine]);

  useEffect(() => () => seekCancelRef.current?.(), []);

  const startFresh = async () => {
    clearSavedLine(decodedTitle);
    setResumeDone(true);
    setResumeStatus(null);
    try {
      await controller?.start();
    } catch (error) {
      pushLog("error", "[playback] start failed:", error);
    }
  };

  // A saved line can sit exactly on a decision. The engine then stops in
  // waiting_decision and the seek callback never reports "reached", leaving the
  // resume overlay stuck on "定位中…" and hiding the choices. Release the
  // overlay as soon as the engine reaches a decision; the player can choose
  // normally and the seek continues from there if it can.
  useEffect(() => {
    if (!resumeBusy || !controller) return;
    const timer = setInterval(() => {
      if (controller.state().state === "waiting_decision") {
        resumeSettledRef.current = true;
        setResumeBusy(false);
        setResumeStatus(null);
        setResumeDone(true);
        setSyncWarning("已到分支选择，请选择后继续阅读。");
      }
    }, 250);
    return () => clearInterval(timer);
  }, [controller, resumeBusy]);

  const resumeFromSaved = async () => {
    if (!controller || !savedLine) return;
    setResumeBusy(true);
    setResumeStatus("正在快进到上次阅读的位置…");
    try {
      await controller.start();
      // Quick-seek restores the previous autoplay mode when it lands. If auto
      // play was on, that would immediately advance past the saved sentence;
      // resume should always stop on the saved line in manual mode.
      controller.setAuto(false);
      seekCancelRef.current?.();
      resumeSettledRef.current = false;
      seekCancelRef.current = controller.seekToLine(
        resumeTarget,
        savedLine.selections,
        (update) => {
          if (resumeSettledRef.current) return;
          if (update.phase === "reached") {
            resumeSettledRef.current = true;
            seekCancelRef.current = null;
            controller.setAuto(false);
            setResumeBusy(false);
            setResumeStatus(null);
            setResumeDone(true);
          } else if (update.phase === "missed" || update.phase === "aborted") {
            resumeSettledRef.current = true;
            seekCancelRef.current = null;
            setResumeBusy(false);
            setResumeStatus(null);
            setResumeDone(true);
            setSyncWarning(
              update.phase === "aborted"
                ? "已取消回到上次位置。"
                : "没有定位到上次的句子（可能是旧版本记录或分支对话），已从头开始播放。"
            );
            void controller.start().catch(() => {});
          }
        }
      );
    } catch (error) {
      setResumeBusy(false);
      setResumeStatus(null);
      setResumeDone(true);
      pushLog("error", "[playback] resume failed:", error);
      void controller.start().catch(() => {});
    }
  };

  // Pop one history level (back to the 章节 detail we came from), so hardware
  // back and this button behave identically.
  const handleBack = () => navigate(-1);

  if (error) {
    return (
      <div style={centerStyle}>
        <div style={{ color: "#f44336", marginBottom: "16px" }}>加载失败: {error}</div>
        <button onClick={handleBack} style={btnStyle}>返回</button>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", background: "#000", position: "relative" }}>
      {!controller && <button onClick={handleBack} style={backBtnStyle} aria-label="返回" title="返回">◀</button>}

      {controller && !loading && (
        <PlayerHUD
          controller={controller}
          script={storyScript}
          onExit={handleBack}
          onError={setSyncWarning}
          next={nextStory}
          onNext={goToNextStory}
        />
      )}

      {controller && !loading && savedLine && !resumeDone && (
        <div className="resume-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-title">
          <div className="resume-card">
            <div className="resume-kicker">上次阅读</div>
            <h2 id="resume-title">回到上次阅读的位置？</h2>
            {resumePreview && (
              <div className="resume-preview">
                {resumePreview.speaker && <b>{resumePreview.speaker}</b>}
                <p>{resumePreview.text}</p>
              </div>
            )}
            <p className="resume-hint">
              退出 App 时会把当前句记在本机，下次可以从这里继续；也可以从头开始。
            </p>
            <div className="resume-actions">
              <button className="resume-primary" onClick={() => void resumeFromSaved()} disabled={resumeBusy}>
                {resumeBusy ? "定位中…" : "继续上次"}
              </button>
              <button className="resume-secondary" onClick={() => void startFresh()} disabled={resumeBusy}>
                从头开始
              </button>
            </div>
            {resumeStatus && <div className="resume-status">{resumeStatus}</div>}
          </div>
        </div>
      )}

      {syncWarning && (
        <div style={warningStyle} role="status">
          {syncWarning}
          <button onClick={() => setSyncWarning(null)} style={warningCloseStyle}>知道了</button>
        </div>
      )}

      {loading && (
        <div style={centerStyle}>
          <div style={{ color: "#929292", fontSize: "16px" }}>{progress.message || status}</div>
          <progress aria-label={progress.message} max={progress.total || 1}
            value={progress.total ? Math.min(progress.done ?? 0, progress.total) : undefined}
            style={{ width: "min(360px, 75vw)", height: "8px", accentColor: "#f4c430" }} />
          {progress.total !== undefined && <div style={{ color: "#929292", fontSize: "13px" }}>
            {progress.phase === "art" ? `${progress.done ?? 0}%` : `${progress.done ?? 0} / ${progress.total}`}
            {progress.bytes ? ` · ${(progress.bytes / 1024 / 1024).toFixed(1)} MB` : ""}
          </div>}
        </div>
      )}

      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", visibility: loading ? "hidden" : "visible" }}
      />
    </div>
  );
}


const centerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  flexDirection: "column",
  gap: "16px",
  background: "#000",
};

const btnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#f4c430",
  color: "#000",
  border: "none",
  borderRadius: "4px",
  fontSize: "14px",
  cursor: "pointer",
};

const warningStyle: React.CSSProperties = {
  position: "fixed",
  top: "calc(8px + var(--safe-top))",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 10000,
  maxWidth: "min(760px, 80vw)",
  padding: "8px 12px",
  whiteSpace: "pre-wrap",
  color: "#fff3cd",
  background: "rgba(92, 67, 0, 0.94)",
  border: "1px solid #d6a900",
  borderRadius: "6px",
  fontSize: "12px",
  lineHeight: 1.4,
};

const warningCloseStyle: React.CSSProperties = {
  marginLeft: "12px",
  padding: "3px 8px",
  color: "#111",
  background: "#f4c430",
  border: 0,
  borderRadius: "3px",
};

// Small, unobtrusive icon-only back button in the corner (the reader is meant to
// be immersive; the system back gesture also works).
const backBtnStyle: React.CSSProperties = {
  position: "fixed",
  top: "calc(6px + var(--safe-top))",
  left: "calc(6px + var(--safe-left))",
  zIndex: 9999,
  width: "30px",
  height: "30px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  background: "rgba(0,0,0,0.4)",
  color: "rgba(255,255,255,0.85)",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: "50%",
  cursor: "pointer",
  fontSize: "14px",
  lineHeight: 1,
};
