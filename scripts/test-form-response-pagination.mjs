import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const formApiSource = readFileSync("public/js/form-api.js", "utf8");
const whiteboardSource = readFileSync("public/js/whiteboard.js", "utf8");

assert.match(
  whiteboardSource,
  /pdfjsLib\.getDocument\(\{ data: pdfData, isEvalSupported: false \}\)/,
  "PDF loading must disable PDF.js expression evaluation",
);

const tempDir = mkdtempSync(join(tmpdir(), "class-whiteboard-form-response-test-"));
try {
  const modulePath = join(tempDir, "form-api.mjs");
  writeFileSync(
    modulePath,
    formApiSource.replace(
      /^import .*?;\r?\n/u,
      "const managementApi = {};\nconst supabase = globalThis.__testSupabase;\nconst supabaseEnabled = true;\n",
    ),
  );

  globalThis.window = {
    CLASS_WHITEBOARD_CONFIG: {},
    addEventListener() {},
  };

  const rows = Array.from({ length: 1200 }, (_, index) => ({
    id: `response-${String(index).padStart(4, "0")}`,
    run_id: "run-1",
    created_at: new Date(Date.UTC(2026, 8, 14, 0, 0, 1199 - index)).toISOString(),
    submitted_at: new Date(Date.UTC(2026, 8, 14, 0, 0, Math.floor(index / 3))).toISOString(),
  }));
  const creationOrderedRows = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  );
  const submittedOrderedRows = [...rows].sort((a, b) =>
    a.submitted_at.localeCompare(b.submitted_at) || a.id.localeCompare(b.id)
  );
  const state = { failAtOffset: null, pageCap: null, returnCount: true, calls: [] };

  class Query {
    constructor() {
      this.from = 0;
      this.to = 0;
      this.orders = [];
      this.selectOptions = null;
    }

    select(_fields, options) {
      this.selectOptions = options;
      return this;
    }

    eq() {
      return this;
    }

    order(column, options) {
      this.orders.push([column, options]);
      return this;
    }

    range(from, to) {
      this.from = from;
      this.to = to;
      return this;
    }

    then(resolve, reject) {
      state.calls.push(this);
      if (this.from === state.failAtOffset) {
        return Promise.resolve({ data: null, count: state.returnCount ? rows.length : null, error: new Error("page failed") })
          .then(resolve, reject);
      }
      const end = this.to + 1;
      const cappedEnd = state.pageCap === null ? end : Math.min(end, this.from + state.pageCap);
      return Promise.resolve({
        data: creationOrderedRows.slice(this.from, cappedEnd),
        count: state.returnCount ? rows.length : null,
        error: null,
      }).then(resolve, reject);
    }
  }

  globalThis.__testSupabase = {
    from(table) {
      assert.equal(table, "form_responses");
      return new Query();
    },
  };

  const { formApi } = await import(pathToFileURL(modulePath).href);
  const responses = await formApi.getResponses("run-1");
  assert.deepEqual(responses, submittedOrderedRows, "all responses must be returned in stable presentation order");
  assert.deepEqual(
    state.calls.map((query) => [query.from, query.to]),
    [[0, 499], [500, 999], [1000, 1499]],
    "responses must be fetched in bounded ranges",
  );
  assert.ok(state.calls.every((query) => query.selectOptions?.count === "exact"));
  assert.deepEqual(
    state.calls[0].orders,
    [["created_at", { ascending: true }], ["id", { ascending: true }]],
    "pagination must use immutable creation ordering",
  );

  state.calls.length = 0;
  state.failAtOffset = 500;
  await assert.rejects(
    () => formApi.getResponses("run-1"),
    /page failed/,
    "a later page failure must be surfaced instead of returning partial data",
  );
  assert.equal(state.calls.length, 2);

  state.calls.length = 0;
  state.failAtOffset = null;
  state.pageCap = 100;
  state.returnCount = false;
  const cappedResponses = await formApi.getResponses("run-1");
  assert.deepEqual(cappedResponses, submittedOrderedRows, "missing counts must still fetch past a smaller server cap");
  assert.equal(state.calls.at(-1).from, 1200, "countless pagination must probe one empty page after the final short page");

  console.log("Form response pagination and PDF option tests passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
