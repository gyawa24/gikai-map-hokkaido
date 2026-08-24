const CHARACTER_VARIANTS = Object.freeze({
  "髙": "高",
  "﨑": "崎",
  "塚": "塚",
  "濵": "浜",
  "邊": "辺",
  "邉": "辺",
  "澤": "沢",
  "舘": "館",
  "嶋": "島",
  "德": "徳",
  "惠": "恵",
  "冨": "富",
  "神": "神",
  "齊": "斉",
  "齋": "斉",
  "國": "国",
  "廣": "広",
  "學": "学",
  "氣": "気",
});

const CHARACTER_VARIANT_PATTERN = new RegExp(
  `[${Object.keys(CHARACTER_VARIANTS).join("")}]`,
  "g"
);

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeForSearch(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(CHARACTER_VARIANT_PATTERN, (char) => CHARACTER_VARIANTS[char] ?? char)
    .replace(/[ヶケヵ]/g, "け")
    .replace(/[・･/／()（）「」『』【】［］\[\]{}｛｝.,，、:：;；!?！？'"`]/g, " ")
    .replace(/\u3000/g, " ")
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
export function compactForSearch(text) {
  return normalizeForSearch(text).replace(/[^\p{L}\p{N}]+/gu, "");
}
