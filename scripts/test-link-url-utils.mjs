import assert from "node:assert/strict";
import { normalizeHttpUrl, openHttpUrl } from "../public/js/link-url-utils.mjs";

assert.equal(normalizeHttpUrl("javascript:opener.pwned=true"), "");
assert.equal(normalizeHttpUrl("data:text/html,pwned"), "");
assert.equal(normalizeHttpUrl("/relative"), "");
assert.equal(normalizeHttpUrl(" https://example.com/path?q=1 "), "https://example.com/path?q=1");
assert.equal(normalizeHttpUrl("http://example.com"), "http://example.com/");

const calls = [];
assert.equal(openHttpUrl("javascript:alert(1)", (...args) => calls.push(args)), false);
assert.equal(openHttpUrl("https://example.com", (...args) => calls.push(args)), true);
assert.deepEqual(calls, [["https://example.com/", "_blank", "noopener,noreferrer"]]);

console.log("Link URL safety utilities passed.");
