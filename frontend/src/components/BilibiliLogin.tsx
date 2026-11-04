import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

interface QrCodeInfo {
  url: string;
  qrcode_key: string;
}

interface QrStatus {
  status: number;
  message: string;
  logged_in: boolean;
}

/**
 * Same-device Bilibili login:
 * - Default: hand the auth URL to the Bilibili app via bilibili://browser.
 *   The user confirms there, then our qrcode poll receives SESSDATA.
 * - Fallback: show the QR for another device / Bilibili app scanner.
 *
 * We intentionally do NOT embed passport.bilibili.com in an iframe: its H5
 * page navigates to bilibili:// itself, which WebView reports as
 * ERR_UNKNOWN_URL_SCHEME before we can intercept it.
 */
export default function BilibiliLogin({ onClose, onSuccess }: Props) {
  const [qr, setQr] = useState<QrCodeInfo | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState("正在生成 B 站登录请求…");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [mode, setMode] = useState<"app" | "qr">("app");

  const generate = async () => {
    setError(null);
    setExpired(false);
    setStatus("正在生成 B 站登录请求…");
    setImage(null);
    try {
      const info = await invoke<QrCodeInfo>("bilibili_qr_generate");
      const dataUrl = await QRCode.toDataURL(info.url, { width: 220, margin: 1 });
      setQr(info);
      setImage(dataUrl);
      setStatus("点下面的按钮，在 B 站 App 里确认登录");
    } catch (reason) {
      setError(String(reason));
      setStatus("");
    }
  };

  useEffect(() => {
    void generate();
  }, []);

  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const result = await invoke<QrStatus>("bilibili_qr_poll", { qrcodeKey: qr.qrcode_key });
        if (stopped) return;
        if (result.logged_in) {
          stopped = true;
          clearInterval(timer);
          setStatus("登录成功");
          onSuccess();
          return;
        }
        if (result.status === 86090) setStatus("已确认，正在返回本 App…");
        else if (result.status === 86101) {
          setStatus(mode === "app" ? "等待在 B 站 App 中确认…" : "等待扫码…");
        } else if (result.status === 86038) {
          stopped = true;
          clearInterval(timer);
          setExpired(true);
          setStatus("登录请求已过期");
        }
      } catch (reason) {
        if (!stopped) setError(String(reason));
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [qr, onSuccess, mode]);

  const openInBilibiliApp = () => {
    if (!qr) return;
    setError(null);
    const deepLink = `bilibili://browser?url=${encodeURIComponent(qr.url)}`;
    setStatus("正在打开 B 站 App…");
    void invoke("open_external", { url: deepLink }).catch((reason) => {
      setError(`没有拉起 B 站 App：${String(reason)}。可以切到「扫码登录」，或在 B 站 App 里打开后重试。`);
      setStatus("");
    });
  };

  return (
    <div className="bili-login-overlay" role="dialog" aria-modal="true" aria-label="登录B站">
      <div className="bili-login-card">
        <div className="bili-login-head">
          <div>
            <div className="bili-kicker">BILIBILI LOGIN</div>
            <h2>登录 B 站账号</h2>
          </div>
          <button className="bili-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="bili-login-tabs">
          <button className={mode === "app" ? "on" : ""} onClick={() => setMode("app")}>
            B站 App 确认
          </button>
          <button className={mode === "qr" ? "on" : ""} onClick={() => setMode("qr")}>
            扫码登录
          </button>
        </div>

        <div className="bili-login-body">
          {mode === "app" ? (
            <>
              <div className="bili-app-icon" aria-hidden="true">B</div>
              <p className="bili-app-copy">
                点下面按钮跳到 B 站 App，在 B 站里点「确认登录」，然后返回本 App。登录态会自动保存。
              </p>
              <button className="bili-app-open" onClick={openInBilibiliApp} disabled={!qr}>
                打开 B 站 App 确认登录
              </button>
            </>
          ) : image ? (
            <img src={image} alt="B站登录二维码" className="bili-qr" />
          ) : (
            <div className="bili-qr-placeholder">
              <span className="opening-spinner" />
            </div>
          )}

          <div className="bili-login-status">{status}</div>
          {expired && <button className="bili-login-retry" onClick={() => void generate()}>刷新登录请求</button>}
          {error && <div className="bili-login-error">{error}</div>}
          <p className="bili-login-help">
            {mode === "app"
              ? "如果 B 站 App 没有自动打开，点上面的按钮重试；也可以切到「扫码登录」。登录态只保存在本机。"
              : "用另一台设备或 B 站 App 的扫一扫扫描；也可以在 B 站 App 里打开二维码链接。"}
          </p>
        </div>
      </div>
    </div>
  );
}
