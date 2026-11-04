use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize)]
pub struct BilibiliVideo {
    pub bvid: String,
    pub title: String,
    pub author: String,
}

fn activity_cache_path() -> PathBuf {
    crate::data_root::data_root().join("bilibili_activity_cache.json")
}

fn cache() -> &'static Mutex<HashMap<String, BilibiliVideo>> {
    static CACHE: OnceLock<Mutex<HashMap<String, BilibiliVideo>>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let cached = std::fs::read_to_string(activity_cache_path())
            .ok()
            .and_then(|text| serde_json::from_str::<HashMap<String, BilibiliVideo>>(&text).ok())
            .unwrap_or_default();
        Mutex::new(cached)
    })
}

fn persist_cache(map: &HashMap<String, BilibiliVideo>) {
    let path = activity_cache_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(map) {
        let _ = std::fs::write(path, text);
    }
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            )
            .cookie_store(true)
            .timeout(Duration::from_secs(20))
            .build()
            .expect("bilibili http client")
    })
}

fn plain_title(raw: &str) -> String {
    raw.replace("<em class=\"keyword\">", "")
        .replace("</em>", "")
        .replace("<em class='keyword'>", "")
        .trim()
        .to_string()
}

/// Resolve one activity name to its official Bilibili "活动先导PV".
///
/// Search results are scored instead of taking the first hit: Bilibili's fuzzy
/// search often returns guides, reactions, or another event's PV first.
#[tauri::command]
pub async fn bilibili_search(
    keyword: String,
    kind: Option<String>,
) -> Result<BilibiliVideo, String> {
    let keyword = keyword.trim().to_string();
    if keyword.is_empty() || keyword.len() > 120 {
        return Err("活动关键词无效".into());
    }
    let is_main = kind.as_deref() == Some("main");
    let term = if is_main { "概念PV" } else { "活动先导PV" };
    let term_lower = term.to_lowercase();
    let keyword_lower = keyword.to_lowercase();
    let cache_key = format!("{}:{keyword}", if is_main { "main" } else { "activity" });
    if let Some(hit) = cache()
        .lock()
        .ok()
        .and_then(|map| map.get(&cache_key).cloned())
    {
        return Ok(hit);
    }

    let query = format!("明日方舟 {keyword} {term}");
    let client = client();
    // Bilibili's search endpoint rejects requests without a buvid3 cookie.
    // Visiting the homepage first populates the cookie jar (same as a browser).
    let _ = client
        .get("https://www.bilibili.com/")
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await;

    let response = client
        .get("https://api.bilibili.com/x/web-interface/search/type")
        .query(&[
            ("search_type", "video"),
            ("keyword", query.as_str()),
            ("page", "1"),
            // Default totalrank hides the official PV for some events; pubdate
            // puts the exact official upload first.
            ("order", "pubdate"),
        ])
        .header("Referer", "https://www.bilibili.com/")
        .header("Origin", "https://www.bilibili.com")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("B站搜索请求失败: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("B站搜索响应读取失败: {e}"))?;
    if !status.is_success() {
        return Err(format!("B站搜索返回 HTTP {status}"));
    }
    let json: Value =
        serde_json::from_str(&text).map_err(|_| "B站搜索返回了非 JSON 内容".to_string())?;
    let code = json.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code != 0 {
        let message = json
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("B站搜索失败（{code}）：{message}"));
    }

    let results = json
        .pointer("/data/result")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut best: Option<(i32, BilibiliVideo)> = None;
    for item in results {
        let bvid = item.get("bvid").and_then(Value::as_str).unwrap_or("");
        if bvid.is_empty() {
            continue;
        }
        let author = item
            .get("author")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let title = plain_title(item.get("title").and_then(Value::as_str).unwrap_or(""));
        let title_lower = title.to_lowercase();
        // Official titles mix 概念PV / 概念pv and 【】/「」; compare lowercased.
        // Do not accept 预告PV / 活动PV / other event PV as a fallback; a wrong
        // video is worse than asking the user to use the Bilibili search page.
        if author != "明日方舟"
            || !title_lower.contains(&term_lower)
            || !title_lower.contains(&keyword_lower)
        {
            continue;
        }
        let mut score = 100;
        if title.contains(&format!("「{keyword}」")) || title.contains(&format!("【{keyword}】")) {
            score += 20;
        }
        if title_lower.contains("sidestory") {
            score += 10;
        }
        let candidate = BilibiliVideo {
            bvid: bvid.to_string(),
            title,
            author,
        };
        if best.as_ref().is_none_or(|(current, _)| score > *current) {
            best = Some((score, candidate));
        }
    }

    let (_, picked) = best.ok_or_else(|| {
        format!("B站没有搜到官方「{keyword}」{term}，可点「B站打开」手动搜索")
    })?;
    if let Ok(mut map) = cache().lock() {
        if map.len() > 128 {
            map.clear();
        }
        map.insert(cache_key, picked.clone());
        persist_cache(&map);
    }
    Ok(picked)
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BilibiliPv {
    pub bvid: String,
    pub title: String,
    pub pv_type: String,
}

const PV_TYPES: &[&str] = &[
    "联动活动宣传PV",
    "联动活动PV",
    "活动先导PV",
    "活动宣传PV",
    "活动预告PV",
    "活动PV",
    "联动PV",
    "主线概念PV",
    "概念PV",
    "主线PV",
    "动画PV",
    "特别PV",
    "纪念PV",
    "主题曲PV",
    "先导PV",
    "宣传PV",
    "预告PV",
    "PV",
];

fn pv_type_of(title: &str) -> Option<String> {
    let lower = title.to_lowercase();
    for term in PV_TYPES {
        let needle = term.to_lowercase();
        if let Some(index) = lower.find(&needle) {
            return Some(title[index..index + needle.len()].to_string());
        }
    }
    None
}

fn pv_cache_path() -> PathBuf {
    crate::data_root::data_root().join("bilibili_pv_cache.json")
}

fn pv_cache() -> &'static Mutex<HashMap<String, Vec<BilibiliPv>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Vec<BilibiliPv>>>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let cached = std::fs::read_to_string(pv_cache_path())
            .ok()
            .and_then(|text| serde_json::from_str::<HashMap<String, Vec<BilibiliPv>>>(&text).ok())
            .unwrap_or_default();
        Mutex::new(cached)
    })
}

fn persist_pv_cache(map: &HashMap<String, Vec<BilibiliPv>>) {
    let path = pv_cache_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(map) {
        let _ = std::fs::write(path, text);
    }
}

async fn fetch_pv_search(query: &str) -> Result<Vec<Value>, String> {
    let client = client();
    let _ = client
        .get("https://www.bilibili.com/")
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await;
    let response = client
        .get("https://api.bilibili.com/x/web-interface/search/type")
        .query(&[
            ("search_type", "video"),
            ("keyword", query),
            ("page", "1"),
            ("order", "pubdate"),
        ])
        .header("Referer", "https://www.bilibili.com/")
        .header("Origin", "https://www.bilibili.com")
        .send()
        .await
        .map_err(|e| format!("B站搜索请求失败: {e}"))?;
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("B站搜索响应失败: {e}"))?;
    if json.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        return Err("B站搜索失败".into());
    }
    Ok(json
        .pointer("/data/result")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

/// Collect every official PV type for one book: activity 先导/宣传/预告/联动,
/// main-story 概念/主线, plus generic PV. Types are read from the official
/// title itself so the UI shows Bilibili's own naming.
#[tauri::command]
pub async fn bilibili_pv_list(
    keyword: String,
    kind: Option<String>,
) -> Result<Vec<BilibiliPv>, String> {
    let keyword = keyword.trim().to_string();
    if keyword.is_empty() || keyword.len() > 120 {
        return Err("活动关键词无效".into());
    }
    let is_main = kind.as_deref() == Some("main");
    let cache_key = format!("{}:{keyword}", if is_main { "main" } else { "activity" });
    if let Some(hit) = pv_cache()
        .lock()
        .ok()
        .and_then(|map| map.get(&cache_key).cloned())
    {
        if !hit.is_empty() {
            return Ok(hit);
        }
    }

    let queries = if is_main {
        vec![
            format!("明日方舟 {keyword} 概念PV"),
            format!("明日方舟 {keyword} 主线PV"),
            format!("明日方舟 {keyword} 动画PV"),
            format!("明日方舟 {keyword} PV"),
        ]
    } else {
        vec![
            format!("明日方舟 {keyword} 活动先导PV"),
            format!("明日方舟 {keyword} 活动宣传PV"),
            format!("明日方舟 {keyword} 活动预告PV"),
            format!("明日方舟 {keyword} PV"),
        ]
    };

    let keyword_lower = keyword.to_lowercase();
    let mut seen = std::collections::HashSet::new();
    let mut output: Vec<BilibiliPv> = Vec::new();
    let mut any_success = false;
    for query in queries {
        match fetch_pv_search(&query).await {
            Ok(items) => {
                any_success = true;
                for item in items {
                    let author = item.get("author").and_then(Value::as_str).unwrap_or("");
                    let bvid = item.get("bvid").and_then(Value::as_str).unwrap_or("");
                    if author != "明日方舟" || bvid.is_empty() || !seen.insert(bvid.to_string()) {
                        continue;
                    }
                    let title = plain_title(item.get("title").and_then(Value::as_str).unwrap_or(""));
                    if !title.to_lowercase().contains(&keyword_lower) {
                        continue;
                    }
                    let Some(pv_type) = pv_type_of(&title) else {
                        continue;
                    };
                    output.push(BilibiliPv {
                        bvid: bvid.to_string(),
                        title,
                        pv_type,
                    });
                }
            }
            Err(_) => continue,
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    if !any_success {
        return Err("B站搜索暂时不可用".into());
    }

    let rank = |value: &str| {
        PV_TYPES
            .iter()
            .position(|term| term.eq_ignore_ascii_case(value))
            .unwrap_or(PV_TYPES.len())
    };
    output.sort_by(|a, b| {
        rank(&a.pv_type)
            .cmp(&rank(&b.pv_type))
            .then_with(|| a.title.cmp(&b.title))
    });
    if let Ok(mut map) = pv_cache().lock() {
        if map.len() > 128 {
            map.clear();
        }
        map.insert(cache_key, output.clone());
        persist_pv_cache(&map);
    }
    Ok(output)
}

#[derive(Serialize)]
pub struct BilibiliPlay {
    pub url: String,
    pub quality: i64,
    pub accept: Vec<i64>,
    pub accept_description: Vec<String>,
}

fn quality_label(qn: i64) -> &'static str {
    match qn {
        80 => "1080P",
        74 => "720P60",
        64 => "720P",
        32 => "480P",
        16 => "360P",
        _ => "自动",
    }
}

/// Get a directly playable MP4 URL (with audio) for the logged-in session.
/// `platform=html5` returns a single durl instead of separate DASH streams, so
/// the app can seek it with a normal <video> and expose its own quality buttons.
#[tauri::command]
pub async fn bilibili_playurl(bvid: String, qn: Option<i64>) -> Result<BilibiliPlay, String> {
    if !bvid.starts_with("BV") || bvid.len() > 20 {
        return Err("无效的 B 站 BV 号".into());
    }
    let qn = qn.unwrap_or(80).clamp(16, 80);
    let client = client();
    let view: Value = client
        .get("https://api.bilibili.com/x/web-interface/view")
        .query(&[("bvid", bvid.as_str())])
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("B站视频信息请求失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("B站视频信息解析失败: {e}"))?;
    if view.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        return Err("B站视频信息获取失败".into());
    }
    let cid = view
        .pointer("/data/cid")
        .and_then(Value::as_i64)
        .ok_or_else(|| "B站视频缺少 cid".to_string())?;

    let cookie_header = read_session()
        .map(|session| {
            session
                .cookies
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ")
        })
        .unwrap_or_default();

    let cid_text = cid.to_string();
    let qn_text = qn.to_string();
    let mut request = client
        .get("https://api.bilibili.com/x/player/playurl")
        .query(&[
            ("bvid", bvid.as_str()),
            ("cid", cid_text.as_str()),
            ("qn", qn_text.as_str()),
            ("fnval", "1"),
            ("platform", "html5"),
            ("high_quality", "1"),
        ])
        .header("Referer", "https://www.bilibili.com/")
        .header("Origin", "https://www.bilibili.com");
    if !cookie_header.is_empty() {
        request = request.header("Cookie", cookie_header);
    }
    let json: Value = request
        .send()
        .await
        .map_err(|e| format!("B站播放地址请求失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("B站播放地址解析失败: {e}"))?;
    if json.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let message = json
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Err(format!("B站播放地址获取失败: {message}"));
    }
    let data = json
        .get("data")
        .ok_or_else(|| "B站播放地址为空".to_string())?;
    let url = data
        .pointer("/durl/0/url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if url.is_empty() {
        return Err("B站没有返回可直接播放的 MP4 地址".into());
    }
    let quality = data.get("quality").and_then(Value::as_i64).unwrap_or(qn);
    let accept = data
        .get("accept_quality")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    let accept_description = data
        .get("accept_description")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let _ = quality_label(quality);
    Ok(BilibiliPlay {
        url,
        quality,
        accept,
        accept_description,
    })
}

#[derive(Serialize)]
pub struct QrCodeInfo {
    pub url: String,
    pub qrcode_key: String,
}

#[derive(Serialize)]
pub struct QrStatus {
    pub status: i64,
    pub message: String,
    pub logged_in: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct Session {
    cookies: HashMap<String, String>,
}

fn session_path() -> PathBuf {
    crate::data_root::data_root().join("bilibili_session.json")
}

fn read_session() -> Option<Session> {
    let text = std::fs::read_to_string(session_path()).ok()?;
    serde_json::from_str::<Session>(&text).ok()
}

fn write_session(session: &Session) -> Result<(), String> {
    let path = session_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let text = serde_json::to_string(session).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

fn apply_session_cookies(app: &tauri::AppHandle, cookies: &HashMap<String, String>) -> Result<(), String> {
    // Wry's Android set_cookie is a no-op (see wry/src/android/mod.rs), so write
    // through android.webkit.CookieManager on the JVM. Otherwise the QR login
    // would succeed but the embedded player would still be anonymous.
    #[cfg(target_os = "android")]
    {
        set_android_cookies(cookies)?;
        let _ = app;
        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "找不到主窗口".to_string())?;
        for (name, value) in cookies {
            let cookie = tauri::webview::Cookie::build((name.clone(), value.clone()))
                .domain(".bilibili.com")
                .path("/")
                .secure(true)
                .http_only(true)
                .same_site(tauri::webview::cookie::SameSite::None)
                .build();
            window.set_cookie(cookie).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(target_os = "android")]
fn set_android_cookies(cookies: &HashMap<String, String>) -> Result<(), String> {
    use jni::objects::JValue;
    use jni::JavaVM;

    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let manager_class = env
        .find_class("android/webkit/CookieManager")
        .map_err(|e| e.to_string())?;
    let manager = env
        .call_static_method(
            manager_class,
            "getInstance",
            "()Landroid/webkit/CookieManager;",
            &[],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;

    for url in ["https://www.bilibili.com", "https://player.bilibili.com"] {
        for (name, value) in cookies {
            let header = format!("{name}={value}; Domain=.bilibili.com; Path=/; Secure; SameSite=None");
            let url = env.new_string(url).map_err(|e| e.to_string())?;
            let header = env.new_string(header).map_err(|e| e.to_string())?;
            env.call_method(
                &manager,
                "setCookie",
                "(Ljava/lang/String;Ljava/lang/String;)V",
                &[JValue::Object(&url), JValue::Object(&header)],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    env.call_method(&manager, "flush", "()V", &[])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn cookies_from_set_cookie(headers: &HeaderMap) -> HashMap<String, String> {
    let wanted = [
        "SESSDATA",
        "bili_jct",
        "DedeUserID",
        "DedeUserID__ckMd5",
        "sid",
        "buvid3",
    ];
    let mut map = HashMap::new();
    for value in headers.get_all("set-cookie").iter() {
        let Ok(text) = value.to_str() else {
            continue;
        };
        let Some(pair) = text.split(';').next() else {
            continue;
        };
        let Some((key, val)) = pair.split_once('=') else {
            continue;
        };
        if wanted.contains(&key) {
            map.insert(key.to_string(), val.trim_matches('"').to_string());
        }
    }
    map
}

fn cookies_from_login_url(raw: &str) -> HashMap<String, String> {
    let query = raw.split_once('?').map(|(_, q)| q).unwrap_or("");
    let wanted = [
        "SESSDATA",
        "bili_jct",
        "DedeUserID",
        "DedeUserID__ckMd5",
        "sid",
        "buvid3",
    ];
    let mut map = HashMap::new();
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        if !wanted.contains(&key) {
            continue;
        }
        let key = urlencoding::decode(key)
            .map(|v| v.into_owned())
            .unwrap_or_else(|_| key.to_string());
        let value = urlencoding::decode(value)
            .map(|v| v.into_owned())
            .unwrap_or_else(|_| value.to_string());
        map.insert(key, value);
    }
    map
}

#[tauri::command]
pub async fn bilibili_qr_generate() -> Result<QrCodeInfo, String> {
    let response = client()
        .get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("B站登录二维码请求失败: {e}"))?;
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("B站登录二维码响应失败: {e}"))?;
    let code = json.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code != 0 {
        return Err(format!("B站登录二维码失败（{code}）"));
    }
    let url = json
        .pointer("/data/url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let qrcode_key = json
        .pointer("/data/qrcode_key")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if url.is_empty() || qrcode_key.is_empty() {
        return Err("B站登录二维码数据不完整".into());
    }
    Ok(QrCodeInfo { url, qrcode_key })
}

#[tauri::command]
pub async fn bilibili_qr_poll(
    qrcode_key: String,
    app: tauri::AppHandle,
) -> Result<QrStatus, String> {
    let response = client()
        .get("https://passport.bilibili.com/x/passport-login/web/qrcode/poll")
        .query(&[("qrcode_key", qrcode_key.as_str())])
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|e| format!("B站登录状态请求失败: {e}"))?;
    let poll_headers = response.headers().clone();
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("B站登录状态响应失败: {e}"))?;
    let outer_code = json.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if outer_code != 0 {
        return Err(format!("B站登录状态失败（{outer_code}）"));
    }
    let status = json
        .pointer("/data/code")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    let message = json
        .pointer("/data/message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if status != 0 {
        return Ok(QrStatus {
            status,
            message,
            logged_in: false,
        });
    }

    let login_url = json
        .pointer("/data/url")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut cookies = cookies_from_login_url(login_url);
    cookies.extend(cookies_from_set_cookie(&poll_headers));

    // On a real QR/app confirmation Bilibili returns a cross-domain login URL
    // instead of putting SESSDATA in data.url. Hit it once without following the
    // redirect so its Set-Cookie headers can be captured directly.
    if !cookies.contains_key("SESSDATA") && !login_url.is_empty() {
        if let Ok(cross) = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            )
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
        {
            if let Ok(response) = cross
                .get(login_url)
                .header("Referer", "https://www.bilibili.com/")
                .send()
                .await
            {
                cookies.extend(cookies_from_set_cookie(response.headers()));
                cookies.extend(cookies_from_login_url(response.url().as_str()));
            }
        }
    }

    if !cookies.contains_key("SESSDATA") {
        let keys = cookies.keys().cloned().collect::<Vec<_>>().join(", ");
        let keys = if keys.is_empty() { "空".to_string() } else { keys };
        return Err(format!(
            "B站登录成功但没有拿到 SESSDATA（收到的 cookie: {keys}）"
        ));
    }
    let session = Session { cookies };
    write_session(&session)?;
    apply_session_cookies(&app, &session.cookies)?;
    Ok(QrStatus {
        status: 0,
        message: "登录成功".into(),
        logged_in: true,
    })
}

#[tauri::command]
pub fn bilibili_session_status() -> bool {
    read_session()
        .map(|s| s.cookies.contains_key("SESSDATA"))
        .unwrap_or(false)
}

#[tauri::command]
pub fn bilibili_restore_session(app: tauri::AppHandle) -> Result<bool, String> {
    let Some(session) = read_session() else {
        return Ok(false);
    };
    if !session.cookies.contains_key("SESSDATA") {
        return Ok(false);
    }
    apply_session_cookies(&app, &session.cookies)?;
    Ok(true)
}

#[tauri::command]
pub fn bilibili_logout() -> Result<(), String> {
    let path = session_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
