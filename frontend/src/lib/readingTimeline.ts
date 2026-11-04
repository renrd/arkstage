export type TimelineKind = "main" | "related" | "optional";

export interface TimelineEntry {
  id: string;
  /** Book cover key (activity_name ?? chapter name) used to resolve the shelf book. */
  title: string;
  kind: TimelineKind;
  /** The main-story point this should be read around, e.g. "第7章". */
  after: string;
  note: string;
}

/**
 * Community-style reading order for the main story plus the events that are
 * strongly tied to it. This is a recommendation, not an official chronology:
 * Arknights deliberately jumps between regions and years, so "release order",
 * "in-world date" and "best first-read order" are three different orders.
 *
 * The spine is the 18 main-story books. Related events are inserted where their
 * context pays off; optional regional arcs are hidden behind a toggle so the
 * default view stays short enough to follow on a phone.
 */
export const READING_TIMELINE: TimelineEntry[] = [
  { id: "main-0a", title: "黑暗时代·上", kind: "main", after: "起点", note: "序章。先认识罗德岛、整合运动与切尔诺伯格。" },
  { id: "main-0b", title: "黑暗时代·下", kind: "main", after: "第0章", note: "龙门篇开场，接异卵同生。" },
  { id: "main-2", title: "异卵同生", kind: "main", after: "第1章", note: "龙门与整合运动的第一次正面冲突。" },
  { id: "main-3", title: "二次呼吸", kind: "main", after: "第2章", note: "继续龙门线。" },
  { id: "main-4", title: "急性衰竭", kind: "main", after: "第3章", note: "龙门线收束，霜星与整合运动登场。" },
  { id: "main-5", title: "靶向药物", kind: "main", after: "第4章", note: "切尔诺伯格废墟，博士与迷迭香。" },
  { id: "main-6", title: "局部坏死", kind: "main", after: "第5章", note: "整合运动内部裂痕；读完可接乌萨斯的孩子们。" },
  { id: "rel-ursus-kids", title: "乌萨斯的孩子们", kind: "related", after: "第6章", note: "强烈推荐。切尔诺伯格学生自治团的过去，补完整合运动与乌萨斯视角。" },
  { id: "main-7", title: "苦难摇篮", kind: "main", after: "第6章", note: "爱国者与霜星线的高潮。" },
  { id: "rel-darknights", title: "生于黑夜", kind: "related", after: "第7章", note: "强烈推荐。W、Scout、特蕾西娅与巴别塔的往事；接怒号光明前读最顺。" },
  { id: "main-8", title: "怒号光明", kind: "main", after: "第7章", note: "切尔诺伯格决战，整合运动主线收束。" },
  { id: "opt-pass", title: "遗尘漫步", kind: "optional", after: "第8章", note: "可选。凯尔希的过去，读完第8章后看更顺。" },
  { id: "opt-seen", title: "如我所见", kind: "optional", after: "第8章", note: "可选。博士与罗德岛的旧事，补充视角。" },
  { id: "main-9", title: "风暴瞭望", kind: "main", after: "第8章", note: "维多利亚篇开幕，深池与号角。" },
  { id: "main-10", title: "破碎日冕", kind: "main", after: "第9章", note: "维多利亚线继续；读完接照我以火。" },
  { id: "rel-fire", title: "照我以火", kind: "related", after: "第10章", note: "强烈推荐。维多利亚线强相关，补深池与塔拉人的立场。" },
  { id: "main-11", title: "淬火尘霾", kind: "main", after: "第10章", note: "维多利亚篇的关键转折。" },
  { id: "opt-time", title: "时间啊，向前！", kind: "optional", after: "第11章", note: "可选。乌萨斯线补充，和主线大事件平行。" },
  { id: "main-12", title: "惊霆无声", kind: "main", after: "第11章", note: "维多利亚篇收束前段。" },
  { id: "main-13", title: "恶兆湍流", kind: "main", after: "第12章", note: "维多利亚篇高潮；读完接巴别塔。" },
  { id: "rel-babel", title: "巴别塔", kind: "related", after: "第13章", note: "极强推荐。特蕾西娅、博士与巴别塔的真相；在第14章前读，第14章会完全不一样。" },
  { id: "main-14", title: "慈悲灯塔", kind: "main", after: "第13章", note: "维多利亚篇终章之一。" },
  { id: "rel-sunset", title: "追迹日落以西", kind: "related", after: "第14章", note: "推荐。维多利亚战后与相关角色的后续，接在慈悲灯塔后。" },
  { id: "main-15", title: "离解复合", kind: "main", after: "第14章", note: "主线进入新阶段。" },
  { id: "rel-tomorrow", title: "我们明日见", kind: "related", after: "第15章", note: "推荐。主线后续强相关，读完离解复合再看。" },
  { id: "main-16", title: "反常光谱", kind: "main", after: "第15章", note: "乌萨斯与主线新阶段。" },
  { id: "main-17", title: "相变临界", kind: "main", after: "第16章", note: "当前主线最新章。" },
  { id: "rel-people", title: "人们，我们", kind: "related", after: "第17章", note: "最新活动，乌萨斯线强相关。建议读完相变临界后再看，避免被主线进度剧透。" },

  { id: "opt-kjerag", title: "银心湖列车", kind: "optional", after: "主线间隙", note: "可选。谢拉格线，先看风雪过境；不影响主线理解。" },
  { id: "opt-lone", title: "孤星", kind: "optional", after: "第11章前后", note: "可选。莱茵生命/哥伦比亚线，独立成篇但信息量大。" },
  { id: "opt-knight", title: "长夜临光", kind: "optional", after: "第10章前后", note: "可选。卡西米尔线，角色与主线有交集。" },
  { id: "opt-sira", title: "叙拉古人", kind: "optional", after: "第11章前后", note: "可选。叙拉古线，独立地区篇。" },
  { id: "opt-abyss", title: "覆潮之下", kind: "optional", after: "第8章前后", note: "可选。深海线入口；后续接愚人号。" },
  { id: "opt-laterano", title: "吾导先路", kind: "optional", after: "第12章前后", note: "可选。拉特兰线入口；后续接空想花庭。" },
  { id: "opt-summer", title: "火山旅梦", kind: "optional", after: "主线间隙", note: "可选。汐斯塔夏日线，轻松独立。" },
  { id: "opt-mujica", title: "无忧梦呓", kind: "optional", after: "联动", note: "Ave Mujica 联动；章节页有「联动动画」，结尾短片已接入。" },
];

export function timelineLabel(kind: TimelineKind): string {
  if (kind === "main") return "主线";
  if (kind === "related") return "强相关";
  return "可选支线";
}
