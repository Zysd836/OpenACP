# CLI Onboarding Setup Design

## Overview

Interactive first-run setup for OpenACP. When a user runs `openacp` for the first time (no config file exists), the app enters an interactive wizard that walks them through configuring Telegram, agents, workspace, and security — then optionally starts OpenACP immediately.

## Motivation

Currently, `ConfigManager.load()` creates a default config file and exits with instructions to edit it manually. This requires users to know the config format, find their Telegram bot token and chat ID, and understand the agent configuration. An interactive setup reduces friction to near-zero.

## Approach

Single-file module `packages/core/src/setup.ts` using `@inquirer/prompts` for interactive prompts. Minimal changes to existing files (`main.ts` and `config.ts`).

## Flow

```
openacp (first run, no config)
  │
  ├─ Welcome banner
  │
  ├─ Step 1: Telegram Setup
  │    ├─ Input: bot token → validate via getMe API
  │    ├─ Input: chat ID → validate via getChat API
  │    └─ Display: "✓ Bot @name connected to 'Group Name'"
  │
  ├─ Step 2: Agent Setup
  │    ├─ Auto-detect agents in PATH (claude, codex, etc.)
  │    ├─ Multi-select: which agents to enable
  │    ├─ If none detected → manual command input
  │    └─ Select: default agent
  │
  ├─ Step 3: Workspace Setup
  │    └─ Input: base directory (default: ~/openacp-workspace)
  │
  ├─ Step 4: Security Setup
  │    ├─ Input: allowed user IDs (comma-separated, or empty = allow all)
  │    ├─ Input: max concurrent sessions (default: 5)
  │    └─ Input: session timeout minutes (default: 60)
  │
  ├─ Step 5: Review & Confirm
  │    ├─ Display full config summary
  │    └─ Confirm to save
  │
  └─ Step 6: Save & Start
       ├─ Write config to ~/.openacp/config.json
       └─ Ask "Start OpenACP now?" → Yes: start / No: exit with instructions
```

## Files Changed

### New: `packages/core/src/setup.ts`

Main module containing:

- `runSetup(configManager: ConfigManager): Promise<boolean>` — orchestrates the entire setup flow, returns `true` if user wants to start immediately
- `setupTelegram(): Promise<TelegramChannelConfig>` — collects and validates Telegram config
- `setupAgents(): Promise<{ agents: Record<string, AgentDefinition>, defaultAgent: string }>` — detects and configures agents
- `setupWorkspace(): Promise<{ baseDir: string }>` — collects workspace path
- `setupSecurity(): Promise<SecurityConfig>` — collects security settings
- `validateBotToken(token: string): Promise<{ ok: true, botName: string, botUsername: string } | { ok: false, error: string }>` — calls Telegram `getMe` API
- `validateChatId(token: string, chatId: number): Promise<{ ok: true, title: string, isForum: boolean } | { ok: false, error: string }>` — calls Telegram `getChat` API
- `detectAgents(): Promise<Array<{ name: string, command: string }>>` — checks PATH for known agent binaries
- `validateAgentCommand(command: string): Promise<boolean>` — checks if binary exists in PATH

### Modified: `packages/core/src/main.ts`

Replace the current "create default config and exit" behavior:

```typescript
const configManager = new ConfigManager()
const configExists = await configManager.exists()

if (!configExists) {
  const { runSetup } = await import('./setup.js')
  const shouldStart = await runSetup(configManager)
  if (!shouldStart) process.exit(0)
}

await configManager.load()
// ... continue normal startup
```

### Modified: `packages/core/src/config.ts`

Add method:

- `exists(): Promise<boolean>` — checks if config file exists without creating it or exiting

### Modified: `packages/core/package.json`

Add dependency: `@inquirer/prompts`

## Validation Details

### Bot Token Validation

Call `https://api.telegram.org/bot{token}/getMe` using `fetch()` (built-in Node 20+). Check for `ok: true` response. Extract `result.first_name` and `result.username` for confirmation display.

### Chat ID Validation

Call `https://api.telegram.org/bot{token}/getChat` with the chat ID. Verify:
- Response is `ok: true`
- Chat type is `supergroup`
- `is_forum` is `true` (topics enabled)

If `is_forum` is false, warn user and suggest enabling Topics in group settings.

### Agent Detection

Check PATH for known binaries using `which` command:
- `claude` / `claude-code` — Claude Code agent
- `codex` — OpenAI Codex agent

For each found binary, create an agent config entry with default args.

### Agent Command Validation

When user inputs a custom command, verify the binary exists using `which`. If not found, display warning but allow proceeding (binary might be installed later).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Network error during validation | Show error, offer: retry / re-enter / skip validation |
| Invalid bot token format | Reject at inquirer validate, ask to re-enter |
| Chat ID not a supergroup | Warning with instructions to create supergroup with Topics |
| No agents detected in PATH | Allow manual command input, warn if binary not found |
| Ctrl+C during setup | No config written, clean exit |
| Cannot write config file | Catch error, display message with path and permissions info |
| Config already exists | Skip setup, load normally (current behavior) |

## Welcome Banner

```
┌──────────────────────────────────────┐
│                                      │
│   Welcome to OpenACP!                │
│                                      │
│   Let's set up your configuration.   │
│                                      │
└──────────────────────────────────────┘
```

## Re-running Setup

For now, users delete `~/.openacp/config.json` and run `openacp` again. In Phase 2, a dedicated `openacp setup` command can be added with `--force` flag.

## Testing

- **Unit tests** for validation functions: mock `fetch` for Telegram API calls, mock `child_process.execSync` for `which` command
- **Unit tests** for `detectAgents()`: mock PATH lookups
- **Integration test**: mock `@inquirer/prompts` to simulate user input through the full flow, verify generated config matches expected output
