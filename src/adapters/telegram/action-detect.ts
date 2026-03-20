import { nanoid } from "nanoid";
import { InlineKeyboard } from "grammy";

export interface DetectedAction {
  action: "new_session" | "cancel_session";
  agent?: string;
  workspace?: string;
}

// Command patterns: /new [agent] [workspace], /cancel
// Agent and workspace are ASCII-only tokens (no Unicode letters) to avoid matching Vietnamese words
const CMD_NEW_RE =
  /\/new(?:\s+([^\s\u0080-\uFFFF]+)(?:\s+([^\s\u0080-\uFFFF]+))?)?/;
const CMD_CANCEL_RE = /\/cancel\b/;

// Keyword patterns (compound phrases only to avoid false positives)
const KW_NEW_RE = /(?:tao|tạo|create|new)\s+session/i;
const KW_CANCEL_RE = /(?:huy|huỷ|cancel|dung|dừng)\s+session/i;

export function detectAction(text: string): DetectedAction | null {
  if (!text) return null;

  // Priority 1: command pattern
  const cancelCmd = CMD_CANCEL_RE.exec(text);
  if (cancelCmd) return { action: "cancel_session" };

  const newCmd = CMD_NEW_RE.exec(text);
  if (newCmd) {
    return {
      action: "new_session",
      agent: newCmd[1] || undefined,
      workspace: newCmd[2] || undefined,
    };
  }

  // Priority 2: keyword matching
  if (KW_CANCEL_RE.test(text)) return { action: "cancel_session" };
  if (KW_NEW_RE.test(text))
    return { action: "new_session", agent: undefined, workspace: undefined };

  return null;
}

// --- Callback map for action buttons ---

const ACTION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const actionMap: Map<string, { action: DetectedAction; createdAt: number }> =
  new Map();

export function storeAction(action: DetectedAction): string {
  const id = nanoid(10);
  actionMap.set(id, { action, createdAt: Date.now() });
  // Cleanup expired entries
  for (const [key, entry] of actionMap) {
    if (Date.now() - entry.createdAt > ACTION_TTL_MS) {
      actionMap.delete(key);
    }
  }
  return id;
}

export function getAction(id: string): DetectedAction | undefined {
  const entry = actionMap.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > ACTION_TTL_MS) {
    actionMap.delete(id);
    return undefined;
  }
  return entry.action;
}

export function removeAction(id: string): void {
  actionMap.delete(id);
}

export function buildActionKeyboard(
  actionId: string,
  action: DetectedAction,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (action.action === "new_session") {
    keyboard.text("✅ Tạo session", `a:${actionId}`);
    keyboard.text("❌ Huỷ", `a:dismiss:${actionId}`);
  } else {
    keyboard.text("⛔ Huỷ session", `a:${actionId}`);
    keyboard.text("❌ Không", `a:dismiss:${actionId}`);
  }
  return keyboard;
}
