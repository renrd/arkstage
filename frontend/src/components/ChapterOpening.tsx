import { useEffect, useRef, useState } from "react";
import { ensurePlaybackAsset } from "../lib/mediaCache";
import { proxyUrl } from "../lib/proxy";
import { setImmersive } from "../lib/immersive";
import { setLandscape } from "../lib/orientation";
import type { ChapterOpening as Opening } from "../lib/chapterOpenings";

interface Props {
  opening: Opening;
  onClose: () => void;
}

function clock(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** How long the header/control bar stays up after a tap. */
const CHROME_HIDE_MS = 5000;

/**
 * Chapter/event movie player. Deliberately uses a custom control bar and a CSS
 * fullscreen stage instead of the native <video controls> UI:
 *
 * - Android WebView's native media UI takes over on tap, and its fullscreen
 *   button is often greyed out while an element is already fullscreen.
 * - With native controls the only way out could be the system back gesture.
 *
 * Here every action (play/pause, seek, mute, fullscreen, close) is ours, so the
 * exit button always works and the chrome can auto-hide safely.
 */
export default function ChapterOpening({ opening, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(false);
  // A blob: URL holds the whole mp4 in memory and is seekable. Direct
  // prts-cdn:// playback is not: the custom protocol returns a plain 200
  // without Range, so Android WebView snaps every seek back to 0.
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every show increments the token; a timer from an older show can never hide
  // a newer one (fixes the "tap shows UI, it vanishes instantly" race).
  const chromeToken = useRef(0);
  const video = opening.videos[index];

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const showChrome = (delay = CHROME_HIDE_MS) => {
    const token = ++chromeToken.current;
    clearHideTimer();
    setChromeVisible(true);
    hideTimer.current = setTimeout(() => {
      if (token === chromeToken.current) setChromeVisible(false);
    }, delay);
  };

  const hideChrome = () => {
    chromeToken.current += 1;
    clearHideTimer();
    setChromeVisible(false);
  };

  const revealChrome = () => {
    if (!expanded) return;
    showChrome();
  };

  // Cache through prts-cdn://, then read the cached bytes into a blob URL.
  // The blob is fully buffered locally, so the custom control bar can seek.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setReady(false);
    setError(null);
    setEnded(false);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setVideoSrc(null);

    const prepare = async () => {
      const proxied = proxyUrl(video.url);
      let source = proxied;
      try {
        await ensurePlaybackAsset(video.url);
        const response = await fetch(proxied);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        source = url;
      } catch (reason) {
        // Fall back to the protocol URL; playback may still work, only seeking
        // is unreliable on WebViews that require Range support.
        console.warn("opening blob preparation failed", reason);
      }
      if (!cancelled) {
        setVideoSrc(source);
        setReady(true);
      }
    };
    void prepare();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [video.url]);

  useEffect(() => {
    if (!expanded) {
      chromeToken.current += 1;
      clearHideTimer();
      setChromeVisible(true);
      return;
    }
    showChrome();
    return () => {
      chromeToken.current += 1;
      clearHideTimer();
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    setLandscape(true);
    setImmersive(true);
    return () => {
      setLandscape(false);
      setImmersive(false);
    };
  }, [expanded]);

  useEffect(() => () => clearHideTimer(), []);

  const toggleFullscreen = () => setExpanded((value) => !value);

  const togglePlay = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play().catch(() => setError("视频播放失败。可能是源站暂时不可用，或本地缓存尚未下载完成。"));
    } else {
      element.pause();
    }
  };

  const seekTo = (value: number) => {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = value;
    setCurrent(value);
  };

  const toggleMute = () => {
    const element = videoRef.current;
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
  };

  const next = () => {
    if (index < opening.videos.length - 1) {
      setIndex(index + 1);
    } else {
      chromeToken.current += 1;
      clearHideTimer();
      setChromeVisible(true);
      setEnded(true);
    }
  };

  const onStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Clicks on our controls/header/ended overlay must not be treated as a
    // request to reveal the chrome or toggle playback.
    if (target.closest(".opening-controls, .opening-head, .opening-ended, .opening-play")) return;
    if (expanded) {
      // Tap toggles the chrome: visible → hide immediately; hidden → show and
      // restart the 5s auto-hide timer.
      if (chromeVisible) hideChrome();
      else revealChrome();
    } else {
      togglePlay();
    }
  };

  return (
    <div className={`opening-overlay ${expanded ? "expanded" : ""}`} role="dialog" aria-modal="true" aria-label={`${opening.title} 开场动画`}>
      <div className={`opening-card ${expanded ? "expanded" : ""} ${expanded && !chromeVisible ? "chrome-hidden" : ""}`}>
        <div className="opening-head">
          <div>
            <div className="opening-kicker">{opening.kicker}</div>
            <h2>{opening.title}</h2>
          </div>
          <button className="opening-fullscreen" onClick={toggleFullscreen}>
            {expanded ? "退出全屏" : "全屏"}
          </button>
          <button className="opening-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="opening-stage" onClick={onStageClick}>
          {!ready && (
            <div className="opening-loading">
              <span className="opening-spinner" />
              正在准备开场视频… 首次播放会缓存到本机
            </div>
          )}
          {ready && videoSrc && !ended && (
            <>
              <video
                key={video.url}
                ref={videoRef}
                className="opening-video"
                src={videoSrc}
                controls={false}
                autoPlay
                playsInline
                preload="auto"
                onPlay={() => {
                  setPlaying(true);
                  if (expanded && chromeVisible) showChrome();
                }}
                onPause={() => {
                  setPlaying(false);
                  chromeToken.current += 1;
                  clearHideTimer();
                  setChromeVisible(true);
                }}
                onLoadedMetadata={(event) => {
                  const value = event.currentTarget.duration;
                  setDuration(Number.isFinite(value) ? value : 0);
                }}
                onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
                onEnded={next}
                onError={() => setError("视频加载失败。可能是源站暂时不可用，或本地缓存尚未下载完成。")}
              />
              {!playing && (
                <button className="opening-play" onClick={togglePlay} aria-label="播放">▶</button>
              )}
              <div
                className={`opening-controls ${expanded && !chromeVisible ? "hidden" : ""}`}
                onClick={(event) => event.stopPropagation()}
              >
                <button className="oc-play" onClick={togglePlay} aria-label={playing ? "暂停" : "播放"}>
                  {playing ? "暂停" : "播放"}
                </button>
                <span className="oc-time">{clock(current)}</span>
                <input
                  className="oc-seek"
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.1)}
                  step={0.1}
                  value={Math.min(current, Math.max(duration, 0.1))}
                  onChange={(event) => seekTo(Number(event.target.value))}
                  aria-label="播放进度"
                />
                <span className="oc-time">{clock(duration)}</span>
                <button className="oc-mute" onClick={toggleMute} aria-label={muted ? "取消静音" : "静音"}>
                  {muted ? "静音" : "声音"}
                </button>
                <button className="oc-fullscreen" onClick={toggleFullscreen}>
                  {expanded ? "退出全屏" : "全屏"}
                </button>
              </div>
            </>
          )}
          {ended && (
            <div className="opening-ended">
              <p>开场动画播放完毕</p>
              <div className="opening-ended-actions">
                <button className="opening-ended-exit" onClick={toggleFullscreen}>
                  {expanded ? "退出全屏" : "全屏"}
                </button>
                <button className="opening-ended-enter" onClick={onClose}>进入剧情</button>
              </div>
            </div>
          )}
        </div>

        {opening.videos.length > 1 && !ended && (
          <div className="opening-tabs">
            {opening.videos.map((item, itemIndex) => (
              <button
                key={item.url}
                className={itemIndex === index ? "on" : ""}
                onClick={() => setIndex(itemIndex)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="opening-error">
            {error}
            <a href={video.url} target="_blank" rel="noreferrer">尝试直接打开</a>
          </div>
        )}

        <p className="opening-foot">
          这段动画不在 AVG 剧本里，是游戏章节入口/活动结尾的独立播放内容；播放器从 PRTS 缓存后离线可看。
        </p>
      </div>
    </div>
  );
}
