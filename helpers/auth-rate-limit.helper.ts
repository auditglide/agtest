const AUTH_REQUEST_INTERVAL_MS = Number(process.env.AUTH_REQUEST_INTERVAL_MS ?? '1500');

let lastAuthRequestAt = 0;

export async function waitForAuthRequestSlot(): Promise<void> {
  if (!Number.isFinite(AUTH_REQUEST_INTERVAL_MS) || AUTH_REQUEST_INTERVAL_MS <= 0) {
    return;
  }

  const now = Date.now();
  const waitMs = Math.max(0, lastAuthRequestAt + AUTH_REQUEST_INTERVAL_MS - now);

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastAuthRequestAt = Date.now();
}
