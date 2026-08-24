function snapshotPayload(payload) {
  return JSON.parse(JSON.stringify(payload || {}));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Realtime差分を必ず1件ずつ送るための小さなキュー。
 *
 * Broadcastを同時並行で送ると、連続ストロークの到着順が前後したり、
 * 一時的な失敗がそのまま欠落になったりする。送信前のpayloadを複製し、
 * サーバー受領が確認できるまで間隔を広げながら再試行してから次へ進む。
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
  const retryBackoffFactor = Math.max(1, Number(options.retryBackoffFactor) || 1);
  const retryJitterMs = Math.max(0, Number(options.retryJitterMs) || 0);
  const random = typeof options.random === "function" ? options.random : Math.random;
  const waitForRetry = typeof options.wait === "function" ? options.wait : wait;
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
          const backoffMs = retryDelayMs * (retryBackoffFactor ** (attempt - 1));
          const jitterMs = retryJitterMs > 0
            ? Math.floor(random() * (retryJitterMs + 1))
            : 0;
          const delayMs = Math.round(backoffMs + jitterMs);
          onRetry?.({ eventName, attempt, maxAttempts, delayMs });
          if (delayMs > 0) await waitForRetry(delayMs);
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
