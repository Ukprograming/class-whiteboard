function snapshotPayload(payload) {
  return JSON.parse(JSON.stringify(payload || {}));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Realtime差分を必ず1件ずつ送るための小さなキュー。
 *
 * HTTP Broadcastを同時並行で送ると、連続ストロークの到着順が前後したり、
 * 一時的な失敗がそのまま欠落になったりする。送信前のpayloadを複製し、
 * サーバー受領が確認できるまで短い間隔で再試行してから次へ進む。
 */
export function createOrderedRetryQueue(send, options = {}) {
  if (typeof send !== "function") {
    throw new TypeError("send must be a function");
  }

  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
  const configuredRetryDelayMs = Number(options.retryDelayMs);
  const retryDelayMs = Number.isFinite(configuredRetryDelayMs)
    ? Math.max(0, configuredRetryDelayMs)
    : 120;
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : null;
  let tail = Promise.resolve();

  function enqueue(eventName, payload) {
    let queuedPayload;
    try {
      queuedPayload = snapshotPayload(payload);
    } catch (error) {
      return Promise.reject(error);
    }

    const task = tail.then(async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let sent = false;
        try {
          sent = (await send(eventName, queuedPayload)) === true;
        } catch (error) {
          if (attempt === maxAttempts) throw error;
        }

        if (sent) return true;
        if (attempt < maxAttempts) {
          onRetry?.({ eventName, attempt, maxAttempts });
          if (retryDelayMs > 0) await wait(retryDelayMs * attempt);
        }
      }
      return false;
    });

    // 1件の失敗で後続の差分まで止まらないよう、内部tailだけは常に解決させる。
    tail = task.then(() => undefined, () => undefined);
    return task;
  }

  return { enqueue };
}
