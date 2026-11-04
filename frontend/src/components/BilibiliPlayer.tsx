import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { setLandscape } from "../lib/orientation";
import { setImmersive } from "../lib/immersive";
import BilibiliLogin from "./BilibiliLogin";

interface Props {
  keyword: string;
  /** Verified official BV id; skips the search and guarantees the exact video. */
  bvid?: string | null;
  kind?: "activity" | "main";
  videos?: BilibiliPv[];
  onClose: () => void;
}

interface BilibiliVideo {
  bvid: string;
  title: string;
  author: string;
}

interface BilibiliPv {
  bvid: string;
  title: string;
  pv_type: string;
}

interface BilibiliPlay {
  url: string;
  quality: number;
  accept: number[];
  accept_description: string[];
}

const QUALITY_LABELS: Record<number, string> = {
  80: "1080P",
  74: "720P60",
  64: "720P",
  32: "480P",
  16: "360P",
};

/**
 * In-app Bilibili PV player. The search happens in Rust (with a cookie jar)
 * because the web search API blocks plain browser requests with HTTP 412.
 */
export default function BilibiliPlayer({ keyword, bvid, kind = "activity", videos, onClose }: Props) {
  const [video, setVideo] = useState<BilibiliVideo | null>(null);
  const [pvList, setPvList] = useState<BilibiliPv[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [quality, setQuality] = useState(80);
  const [play, setPlay] = useState<BilibiliPlay | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chromeToken = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  const term = kind === "main" ? "概念PV" : "活动先导PV";
  const searchUrl = `https://space.bilibili.com/161775300/search/video?keyword=${encodeURIComponent(`${keyword} ${term}`)}`;
  const watchUrl = video ? `https://www.bilibili.com/video/${video.bvid}` : searchUrl;

  useEffect(() => {
    void invoke<boolean>("bilibili_restore_session")
      .then((ok) => setLoggedIn(ok))
      .catch(() => setLoggedIn(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setVideo(null);
    setPvList([]);
    setError(null);
    setPlay(null);
    setPlayError(null);
    if (videos && videos.length > 0) {
      setPvList(videos);
      const chosen = (bvid && videos.find((item) => item.bvid === bvid)) || videos[0];
      setVideo({ bvid: chosen.bvid, title: chosen.title, author: "明日方舟" });
      return () => {
        cancelled = true;
      };
    }
    if (bvid) {
      setVideo({ bvid, title: keyword, author: "明日方舟" });
    }
    void invoke<BilibiliPv[]>("bilibili_pv_list", { keyword, kind })
      .then((list) => {
        if (cancelled) return;
        const withCurated =
          bvid && !list.some((item) => item.bvid === bvid)
            ? [
                {
                  bvid,
                  title: keyword,
                  pv_type: kind === "main" ? "概念PV" : "活动先导PV",
                },
                ...list,
              ]
            : list;
        setPvList(withCurated);
        if (withCurated.length === 0) {
          if (!bvid) setError("B站没有搜到这本书的官方 PV");
          return;
        }
        const chosen =
          (bvid && withCurated.find((item) => item.bvid === bvid)) || withCurated[0];
        setVideo({ bvid: chosen.bvid, title: chosen.title, author: "明日方舟" });
      })
      .catch((reason) => {
        if (!cancelled && !bvid) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [keyword, bvid, kind, videos]);

  useEffect(() => {
    if (!video) return;
    let cancelled = false;
    setPlay(null);
    setPlayError(null);
    setLoadingPlay(true);
    void invoke<BilibiliPlay>("bilibili_playurl", { bvid: video.bvid, qn: quality })
      .then((result) => {
        if (!cancelled) setPlay(result);
      })
      .catch((reason) => {
        if (!cancelled) setPlayError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoadingPlay(false);
      });
    return () => {
      cancelled = true;
    };
  }, [video, quality, reloadKey]);

  useEffect(() => {
    if (!expanded) return;
    setLandscape(true);
    setImmersive(true);
    return () => {
      setLandscape(false);
      setImmersive(false);
    };
  }, [expanded]);

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const showChrome = () => {
    const token = ++chromeToken.current;
    clearHideTimer();
    setChromeVisible(true);
    hideTimer.current = setTimeout(() => {
      if (token === chromeToken.current) setChromeVisible(false);
    }, 4000);
  };

  const hideChrome = () => {
    chromeToken.current += 1;
    clearHideTimer();
    setChromeVisible(false);
  };

  // Only native MP4 playback gets tap-to-reveal; an iframe cannot bubble taps
  // back to us, so its header/quality bar must stay visible.
  useEffect(() => {
    if (!expanded || !play) {
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
  }, [expanded, play]);

  useEffect(() => () => clearHideTimer(), []);

  const onStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!expanded || !play) return;
    const target = event.target as HTMLElement;
    if (target.closest(".bili-quality, .bili-controls, .bili-pv-tabs, .bili-error, .bili-loading")) return;
    if (chromeVisible) hideChrome();
    else showChrome();
  };

  const togglePlay = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play().catch(() => setPlayError("B站直链播放失败，已切换到内嵌播放器"));
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

  const clock = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const total = Math.floor(value);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  const openInBrowser = () => {
    void invoke("open_external", { url: searchUrl }).catch((reason) => {
      setError(`无法打开浏览器：${String(reason)}`);
    });
  };

  const openInBilibili = () => {
    void invoke("open_external", { url: watchUrl }).catch((reason) => {
      setError(`无法打开 B 站：${String(reason)}`);
    });
  };

  return (
    <div className={`bili-overlay ${expanded ? "expanded" : ""}`} role="dialog" aria-modal="true" aria-label="B站活动先导PV">
      <div className={`bili-card ${expanded ? "expanded" : ""} ${expanded && !chromeVisible ? "chrome-hidden" : ""}`}>
        <div className="bili-head">
          <div>
            <div className="bili-kicker">BILIBILI · {kind === "main" ? "概念PV" : "活动先导PV"}</div>
            <h2>{keyword}</h2>
          </div>
          <button className="bili-action" onClick={() => setShowLogin(true)}>
            {loggedIn ? "已登录" : "登录B站"}
          </button>
          <button className="bili-action" onClick={() => setExpanded(!expanded)}>
            {expanded ? "退出全屏" : "全屏"}
          </button>
          <button className="bili-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="bili-stage" onClick={onStageClick}>
          {!video && !error && (
            <div className="bili-loading">
              <span className="opening-spinner" />
              正在搜索 B 站官方视频…
            </div>
          )}
          {video && play && (
            <video
              key={`${play.url}-${quality}-${reloadKey}`}
              ref={videoRef}
              className="bili-native"
              src={play.url}
              controls={false}
              autoPlay
              playsInline
              preload="auto"
              onPlay={() => {
                setPlaying(true);
                if (expanded) showChrome();
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
              onError={() => setPlayError("B站直链播放失败，已切换到内嵌播放器")}
            />
          )}
          {video && !play && loadingPlay && (
            <div className="bili-loading">
              <span className="opening-spinner" />
              正在获取 {QUALITY_LABELS[quality] ?? "高清"} 播放地址…
            </div>
          )}
          {video && !play && !loadingPlay && (
            <iframe
              key={`${video.bvid}-${reloadKey}`}
              className="bili-frame"
              title={video.title || keyword}
              src={`https://player.bilibili.com/player.html?bvid=${encodeURIComponent(video.bvid)}&page=1&high_quality=1&qn=${quality}&as_wide=1&danmaku=0&autoplay=1`}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
            />
          )}
          {error && (
            <div className="bili-error">
              <p>没有在 App 内搜到这本书的官方 PV。</p>
              <p className="bili-error-detail">{error}</p>
              <button onClick={openInBrowser}>在浏览器打开官方视频搜索</button>
            </div>
          )}
          {pvList.length > 0 && (
            <div className="bili-pv-tabs" onClick={(event) => event.stopPropagation()}>
              {pvList.map((item) => (
                <button
                  key={item.bvid}
                  className={video?.bvid === item.bvid ? "on" : ""}
                  title={item.title}
                  onClick={() => setVideo({ bvid: item.bvid, title: item.title, author: "明日方舟" })}
                >
                  {item.pv_type}
                </button>
              ))}
            </div>
          )}
          {video && (
            <div className="bili-quality" onClick={(event) => event.stopPropagation()}>
              {[80, 64, 32].map((value) => {
                const available = !play || play.accept.length === 0 || play.accept.includes(value);
                return (
                  <button
                    key={value}
                    className={quality === value ? "on" : ""}
                    disabled={!available}
                    onClick={() => setQuality(value)}
                  >
                    {QUALITY_LABELS[value]}
                  </button>
                );
              })}
              <span>{loggedIn ? "已登录，清晰度以 B 站账号权限为准" : "未登录 B 站；登录后可解锁更高清晰度"}</span>
            </div>
          )}
          {play && (
            <div className="bili-controls" onClick={(event) => event.stopPropagation()}>
              <button className="bili-ctrl-play" onClick={togglePlay} aria-label={playing ? "暂停" : "播放"}>
                {playing ? "暂停" : "播放"}
              </button>
              <span className="bili-ctrl-time">{clock(current)}</span>
              <input
                className="bili-ctrl-seek"
                type="range"
                min={0}
                max={Math.max(duration, 0.1)}
                step={0.1}
                value={Math.min(current, Math.max(duration, 0.1))}
                onChange={(event) => seekTo(Number(event.target.value))}
                aria-label="播放进度"
              />
              <span className="bili-ctrl-time">{clock(duration)}</span>
              <button className="bili-ctrl-mute" onClick={toggleMute} aria-label={muted ? "取消静音" : "静音"}>
                {muted ? "静音" : "声音"}
              </button>
            </div>
          )}
        </div>

        {video && (
          <div className="bili-meta">
            <span>{video.title}</span>
            <span>{video.author}</span>
            {play && (
              <span className="bili-quality-label">
                当前 {QUALITY_LABELS[play.quality] ?? `${play.quality}P`}
              </span>
            )}
            <button className="bili-open" onClick={openInBilibili}>B站打开</button>
          </div>
        )}
        {playError && (
          <p className="bili-play-warning">{playError}</p>
        )}
        <p className="bili-foot">
          直链播放会按所选清晰度向 B 站请求 MP4；如果账号没有该档权限，B 站会自动降级。需要联网，不缓存。
        </p>
      </div>

      {showLogin && (
        <BilibiliLogin
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            setShowLogin(false);
            setLoggedIn(true);
            setReloadKey((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
