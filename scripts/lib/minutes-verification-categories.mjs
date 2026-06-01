export const OCR_WAIT = new Set(["shosanbetsu", "yubetsu"]);

export const RECHECK_WAIT = new Set([
  "kamikawa",
  "ikeda",
  "nakagawa",
  "naganuma",
  "shimamaki",
  "suttsu",
  "kuromatsunai",
  "kimobetsu",
  "kyogoku",
  "kyowa",
  "tomari",
  "kamoenai",
  "shakotan",
  "samani",
  "erimo",
  "shikabe",
  "otobe",
  "okushiri",
  "takasu",
  "higashikagura",
  "pippu",
  "nakafurano",
  "wassamu",
  "otoineppu",
  "mashike",
  "obira",
  "tomamae",
  "hamatombetsu",
  "rebun",
  "rishiri",
  "rishirifuji",
  "shari",
  "okoppe",
  "nishiokoppe",
  "teshikaga",
  "tsurui",
  "shiranuka",
  "shibetsucho",
]);

export const ALT_FEATURES = new Map([
  ["nakashibetsu", "一般質問・委員会代表質問PDF"],
  ["sarufutsu", "一般質問PDF"],
  ["kaminokuni", "一般質問の質問・答弁要旨"],
  ["toma", "一般質問と答弁"],
  ["minamifurano", "会議結果・一般質問"],
  ["shinshinotsu", "議決結果・一般質問"],
  ["aibetsu", "一般質問動画"],
  ["omu", "一般質問単位の議事録"],
  ["saroma", "令和2年までの古い会議録"],
  ["takinoue", "会議結果・議会広報・瓦版"],
  ["teshio", "議会だより・視察研修報告書"],
  ["kenbuchi", "議会だより・YouTube配信・議会情報"],
  ["rusutsu", "議事日程・議決結果・議会活動"],
  ["iwanai", "議事日程・議会だより・一般質問順序表"],
]);

export function minutesVerificationCategory(slug) {
  if (OCR_WAIT.has(slug)) {
    return { id: "ocr", label: "OCR待ち", note: "OCR下書き・原文照合" };
  }
  if (ALT_FEATURES.has(slug)) {
    return { id: "alt-feature", label: "別feature候補", note: ALT_FEATURES.get(slug) };
  }
  if (RECHECK_WAIT.has(slug)) {
    return { id: "recheck", label: "再確認待ち", note: "90日再確認" };
  }
  return { id: "other", label: "未分類", note: "分類見直し" };
}
