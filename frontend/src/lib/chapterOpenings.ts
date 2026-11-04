import { ensurePlaybackAsset } from "./mediaCache";

export interface OpeningVideo {
  label: string;
  /** Original https URL; playback goes through the cached prts-cdn protocol. */
  url: string;
}

export interface ChapterOpening {
  bookKey: string;
  title: string;
  /** Button text in the chapter header ("开场动画" / "活动动画" / "联动动画"). */
  buttonLabel: string;
  /** Small caption above the player title. */
  kicker: string;
  videos: OpeningVideo[];
}

const VIDEO_ROOT = "https://torappu.prts.wiki/assets/video";

/**
 * Every standalone animation currently exposed by PRTS' raw/video tree.
 *
 * The AVG script only contains the story commands; chapter-entry movies and
 * event-ending clips are separate files. PRTS stores the transcoded mp4s under
 * raw/video and serves them under /assets/video/. They are not in the story
 * manifests, so the reader caches them explicitly through prts-cdn://.
 *
 * `bg_mainline_*` are animated background loops rather than story clips and are
 * intentionally not attached to a chapter.
 */
export const CHAPTER_OPENINGS: ChapterOpening[] = [
  {
    bookKey: "风暴瞭望",
    title: "第九章 · 风暴瞭望",
    buttonLabel: "开场动画",
    kicker: "CHAPTER OPENING",
    // This is the chapter-8 ending 升变, played at the start of chapter 9.
    videos: [{ label: "第八章末尾 · 升变", url: `${VIDEO_ROOT}/01.mp4` }],
  },
  {
    bookKey: "破碎日冕",
    title: "第十章 · 破碎日冕",
    buttonLabel: "开场动画",
    kicker: "CHAPTER OPENING",
    videos: [
      { label: "序章动画", url: `${VIDEO_ROOT}/main_10/main_10_enter.mp4` },
      { label: "剧情 PV", url: `${VIDEO_ROOT}/03.mp4` },
    ],
  },
  {
    bookKey: "淬火尘霾",
    title: "第十一章 · 淬火尘霾",
    buttonLabel: "开场动画",
    kicker: "CHAPTER OPENING",
    videos: [{ label: "开场动画", url: `${VIDEO_ROOT}/main_11/main_11_enter.mp4` }],
  },
  {
    bookKey: "惊霆无声",
    title: "第十二章 · 惊霆无声",
    buttonLabel: "开场动画",
    kicker: "CHAPTER OPENING",
    videos: [{ label: "开场动画", url: `${VIDEO_ROOT}/main_12/main_12_enter.mp4` }],
  },
  {
    bookKey: "恶兆湍流",
    title: "第十三章 · 恶兆湍流",
    buttonLabel: "开场动画",
    kicker: "CHAPTER OPENING",
    videos: [{ label: "开场动画", url: `${VIDEO_ROOT}/main_13/main_13_01.mp4` }],
  },
  {
    bookKey: "慈悲灯塔",
    title: "第十四章 · 慈悲灯塔",
    buttonLabel: "结尾动画",
    kicker: "CHAPTER ENDING",
    // Amiya's second 升变 (Medic), at the end of 14-22.
    videos: [{ label: "第二次升变（医疗）", url: `${VIDEO_ROOT}/02.mp4` }],
  },

  {
    bookKey: "墟",
    title: "墟 · 活动动画",
    buttonLabel: "活动动画",
    kicker: "EVENT ANIMATION",
    videos: [{ label: "活动动画", url: `${VIDEO_ROOT}/act44side/at01.mp4` }],
  },
  {
    bookKey: "无忧梦呓",
    title: "无忧梦呓 · Ave Mujica 联动",
    buttonLabel: "联动动画",
    kicker: "COLLAB ANIMATION",
    videos: [{ label: "联动动画", url: `${VIDEO_ROOT}/act45side/ss01.mp4` }],
  },
  {
    bookKey: "辞岁行",
    title: "辞岁行 · 活动动画",
    buttonLabel: "活动动画",
    kicker: "EVENT ANIMATION",
    videos: [{ label: "活动动画", url: `${VIDEO_ROOT}/act49side/ta02.mp4` }],
  },
  {
    bookKey: "时间啊，向前！",
    title: "时间啊，向前！ · 活动动画",
    buttonLabel: "活动动画",
    kicker: "EVENT ANIMATION",
    videos: [
      { label: "上部", url: `${VIDEO_ROOT}/act55side/tl01.mp4` },
      { label: "下部", url: `${VIDEO_ROOT}/act55side/tl02.mp4` },
    ],
  },
];

export function openingForBook(bookKey: string): ChapterOpening | undefined {
  return CHAPTER_OPENINGS.find((opening) => opening.bookKey === bookKey);
}

export function mainOpeningUrls(): string[] {
  return [...new Set(
    CHAPTER_OPENINGS
      .filter((opening) => opening.kicker.startsWith("CHAPTER"))
      .flatMap((opening) => opening.videos.map((video) => video.url))
  )];
}

export function eventOpeningUrls(): string[] {
  return [...new Set(
    CHAPTER_OPENINGS
      .filter((opening) => !opening.kicker.startsWith("CHAPTER"))
      .flatMap((opening) => opening.videos.map((video) => video.url))
  )];
}

export function allOpeningUrls(includeEvents = true): string[] {
  return [...new Set([
    ...mainOpeningUrls(),
    ...(includeEvents ? eventOpeningUrls() : []),
  ])];
}

/** Cache every chapter opening (used by the first-run full/main preset). */
export async function cacheAllOpenings(includeEvents = true): Promise<void> {
  await Promise.allSettled(allOpeningUrls(includeEvents).map((url) => ensurePlaybackAsset(url)));
}
