#!/usr/bin/env node

import { installPlugin, uninstallPlugin, listPlugins } from './core/plugin-manager.js'
import { readApiPort, removeStalePortFile, apiCall } from './core/api-client.js'

const args = process.argv.slice(2)
const command = args[0]

function printHelp(): void {
  console.log(`
OpenACP - Self-hosted bridge for AI coding agents

Usage:
  openacp                              Start (mode from config)
  openacp start                        Start as background daemon
  openacp stop                         Stop background daemon
  openacp status                       Show daemon status
  openacp logs                         Tail daemon log file
  openacp config                       Edit configuration
  openacp install <package>            Install a plugin adapter
  openacp uninstall <package>          Uninstall a plugin adapter
  openacp plugins                      List installed plugins
  openacp --foreground                 Force foreground mode
  openacp --version                    Show version
  openacp --help                       Show this help

Runtime (requires running daemon):
  openacp runtime new [agent]       Create a new session
  openacp runtime cancel <id>       Cancel a session
  openacp runtime status            Show active sessions
  openacp runtime agents            List available agents

Note: "openacp status" shows daemon process health.
      "openacp runtime status" shows active agent sessions.

Install:
  npm install -g @openacp/cli
`)
}

async function main() {
  if (command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === '--version' || command === '-v') {
    // In published build: read version from own package.json via createRequire
    // In dev: fallback to 'dev'
    try {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const pkg = require('../package.json')
      console.log(`openacp v${pkg.version}`)
    } catch {
      console.log('openacp v0.0.0-dev')
    }
    return
  }

  if (command === 'install') {
    const pkg = args[1]
    if (!pkg) {
      console.error('Usage: openacp install <package>')
      process.exit(1)
    }
    installPlugin(pkg)
    return
  }

  if (command === 'uninstall') {
    const pkg = args[1]
    if (!pkg) {
      console.error('Usage: openacp uninstall <package>')
      process.exit(1)
    }
    uninstallPlugin(pkg)
    return
  }

  if (command === 'plugins') {
    const plugins = listPlugins()
    const entries = Object.entries(plugins)
    if (entries.length === 0) {
      console.log('No plugins installed.')
    } else {
      console.log('Installed plugins:')
      for (const [name, version] of entries) {
        console.log(`  ${name}@${version}`)
      }
    }
    return
  }

  if (command === 'runtime') {
    const subCmd = args[1]

    const port = readApiPort()
    if (port === null) {
      console.error('OpenACP is not running. Start with `openacp start`')
      process.exit(1)
    }

    try {
      if (subCmd === 'new') {
        const agent = args[2]
        const workspaceIdx = args.indexOf('--workspace')
        const workspace = workspaceIdx !== -1 ? args[workspaceIdx + 1] : undefined
        const body: Record<string, string> = {}
        if (agent) body.agent = agent
        if (workspace) body.workspace = workspace

        const res = await apiCall(port, '/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json() as Record<string, unknown>
        if (!res.ok) {
          console.error(`Error: ${data.error}`)
          process.exit(1)
        }
        console.log('Session created')
        console.log(`  ID     : ${data.sessionId}`)
        console.log(`  Agent  : ${data.agent}`)
        console.log(`  Status : ${data.status}`)

      } else if (subCmd === 'cancel') {
        const sessionId = args[2]
        if (!sessionId) {
          console.error('Usage: openacp runtime cancel <session-id>')
          process.exit(1)
        }
        const res = await apiCall(port, `/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
        })
        const data = await res.json() as Record<string, unknown>
        if (!res.ok) {
          console.error(`Error: ${data.error}`)
          process.exit(1)
        }
        console.log(`Session ${sessionId} cancelled`)

      } else if (subCmd === 'status') {
        const res = await apiCall(port, '/api/sessions')
        const data = await res.json() as { sessions: Array<{ id: string; agent: string; status: string; name: string | null }> }
        if (data.sessions.length === 0) {
          console.log('No active sessions.')
        } else {
          console.log(`Active sessions: ${data.sessions.length}\n`)
          for (const s of data.sessions) {
            const name = s.name ? `  "${s.name}"` : ''
            console.log(`  ${s.id}  ${s.agent}  ${s.status}${name}`)
          }
        }

      } else if (subCmd === 'agents') {
        const res = await apiCall(port, '/api/agents')
        const data = await res.json() as { agents: Array<{ name: string; command: string; args: string[] }>; default: string }
        console.log('Available agents:')
        for (const a of data.agents) {
          const isDefault = a.name === data.default ? ' (default)' : ''
          console.log(`  ${a.name}${isDefault}`)
        }

      } else {
        console.error(`Unknown runtime command: ${subCmd || '(none)'}\n`)
        console.log('Usage:')
        console.log('  openacp runtime new [agent]         Create a new session')
        console.log('  openacp runtime cancel <id>         Cancel a session')
        console.log('  openacp runtime status              Show active sessions')
        console.log('  openacp runtime agents              List available agents')
        process.exit(1)
      }
    } catch (err) {
      if (err instanceof TypeError && (err as any).cause?.code === 'ECONNREFUSED') {
        console.error('OpenACP is not running (stale port file)')
        removeStalePortFile()
        process.exit(1)
      }
      throw err
    }
    return
  }

  if (command === 'start') {
    const { startDaemon, getPidPath } = await import('./core/daemon.js')
    const { ConfigManager } = await import('./core/config.js')
    const cm = new ConfigManager()
    if (await cm.exists()) {
      await cm.load()
      const config = cm.get()
      const result = startDaemon(getPidPath(), config.logging.logDir)
      if ('error' in result) {
        console.error(result.error)
        process.exit(1)
      }
      console.log(`OpenACP daemon started (PID ${result.pid})`)
    } else {
      console.error('No config found. Run "openacp" first to set up.')
      process.exit(1)
    }
    return
  }

  if (command === 'stop') {
    const { stopDaemon } = await import('./core/daemon.js')
    const result = stopDaemon()
    if (result.stopped) {
      console.log(`OpenACP daemon stopped (was PID ${result.pid})`)
    } else {
      console.error(result.error)
      process.exit(1)
    }
    return
  }

  if (command === 'status') {
    const { getStatus } = await import('./core/daemon.js')
    const status = getStatus()
    if (status.running) {
      console.log(`OpenACP is running (PID ${status.pid})`)
    } else {
      console.log('OpenACP is not running')
    }
    return
  }

  if (command === 'logs') {
    const { spawn } = await import('node:child_process')
    const { ConfigManager, expandHome } = await import('./core/config.js')
    const pathMod = await import('node:path')
    const cm = new ConfigManager()
    let logDir = '~/.openacp/logs'
    if (await cm.exists()) {
      await cm.load()
      logDir = cm.get().logging.logDir
    }
    const logFile = pathMod.join(expandHome(logDir), 'openacp.log')
    const tail = spawn('tail', ['-f', '-n', '50', logFile], { stdio: 'inherit' })
    tail.on('error', (err: Error) => {
      console.error(`Cannot tail log file: ${err.message}`)
      process.exit(1)
    })
    return
  }

  if (command === 'config') {
    const { runConfigEditor } = await import('./core/config-editor.js')
    const { ConfigManager } = await import('./core/config.js')
    const cm = new ConfigManager()
    if (!(await cm.exists())) {
      console.error('No config found. Run "openacp" first to set up.')
      process.exit(1)
    }
    await runConfigEditor(cm)
    return
  }

  // Handle --daemon-child (internal flag for background server)
  if (command === '--daemon-child') {
    const { startServer } = await import('./main.js')
    await startServer()
    return
  }

  // Handle --foreground flag
  const forceForeground = command === '--foreground'

  // Reject unknown commands
  if (command && !command.startsWith('-')) {
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
  }

  // Default: start server based on config runMode
  const { ConfigManager } = await import('./core/config.js')
  const cm = new ConfigManager()

  // If no config, run setup first
  if (!(await cm.exists())) {
    const { runSetup } = await import('./core/setup.js')
    const shouldStart = await runSetup(cm)
    if (!shouldStart) process.exit(0)
    // Config now exists — fall through to read runMode and start accordingly
  }

  await cm.load()
  const config = cm.get()

  if (!forceForeground && config.runMode === 'daemon') {
    // Daemon mode: spawn background process
    const { startDaemon, getPidPath } = await import('./core/daemon.js')
    const result = startDaemon(getPidPath(), config.logging.logDir)
    if ('error' in result) {
      console.error(result.error)
      process.exit(1)
    }
    console.log(`OpenACP daemon started (PID ${result.pid})`)
    return
  }

  // Foreground mode — clear stopped marker since user is explicitly starting
  const { clearUserStopped } = await import('./core/daemon.js')
  clearUserStopped()
  const { startServer } = await import('./main.js')
  await startServer()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
