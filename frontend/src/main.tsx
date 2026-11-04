import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installGlobalCapture } from "./lib/debugLog";
import "./styles/global.css";
import "./styles/browser.css";

// Capture main-window errors/warnings before anything else runs.
installGlobalCapture();

/**
 * Device/shape classes for layout tuning. CSS media queries already cover the
 * broad cases; this adds a precise class for the 6.83" 1272x2800 class of tall
 * Android phones (Honor WIN RT and similar) so the directory can use slightly
 * taller rows and the reader header can use the extra vertical room.
 */
function applyViewportClasses(): void {
  const root = document.documentElement;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  // WebView implementations disagree on whether screen.width is CSS px or
  // physical px. Check all plausible interpretations before deciding.
  const candidates: Array<[number, number]> = [
    [window.screen.width * dpr, window.screen.height * dpr],
    [window.screen.width, window.screen.height],
    [width * dpr, height * dpr],
  ];
  const honorWinRt = candidates.some(([candidateWidth, candidateHeight]) => {
    const shortSide = Math.min(candidateWidth, candidateHeight);
    const longSide = Math.max(candidateWidth, candidateHeight);
    return shortSide >= 1260 && shortSide <= 1285
      && longSide >= 2780 && longSide <= 2815;
  });
  root.dataset.device = honorWinRt ? "honor-winrt" : "generic";
  root.dataset.viewport = width >= 400 && width <= 500 && height >= 800 ? "tall-phone" : "default";
  root.dataset.orientation = width > height ? "landscape" : "portrait";
}

applyViewportClasses();
window.addEventListener("resize", applyViewportClasses, { passive: true });
window.addEventListener("orientationchange", applyViewportClasses, { passive: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
