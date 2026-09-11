import assert from "node:assert/strict";
import { formatTextCount } from "../public/js/text-count.mjs";

for (const [text, expected] of [
  ["", "(0語)"],
  ["  \n\t ", "(0語)"],
  ["Hello, world!", "(2語)"],
  ["I don't think it’s a well-known fact.", "(7語)"],
  ["one\ntwo\tthree — !", "(3語)"],
  ["こんにちは。", "(6文字)"],
  ["日本語　です\nね", "(6文字)"],
  ["英語 Hello", "(7文字)"],
  ["か\u3099👨‍👩‍👧‍👦", "(2文字)"],
  ["ｶﾀｶﾅ", "(4文字)"],
  ["... !!! 😀", "(0語)"]
]) assert.equal(formatTextCount(text), expected, JSON.stringify(text));
console.log("Text count tests passed.");
