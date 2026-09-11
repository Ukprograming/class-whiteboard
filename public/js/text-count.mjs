// Japanese (including mixed-language text): count visible characters, including
// punctuation, but excluding whitespace. English: punctuation is not a word;
// contractions and hyphenated compounds each count as one word.
const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });

export function formatTextCount(value = "") {
  const text = String(value ?? "");
  if (japanese.test(text)) {
    const count = Array.from(graphemes.segment(text.replace(/\s/gu, ""))).length;
    return `(${count}文字)`;
  }
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’\-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu);
  return `(${words?.length || 0}語)`;
}
