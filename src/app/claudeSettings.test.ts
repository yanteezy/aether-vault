// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installDom } from './dom.js'

const invoke = vi.fn(async (ch: string) => (ch === 'claude:info' ? { mcpb: 'C:/x/aether.mcpb', server: 'C:/x/server.js' } : ''))
vi.mock('electron', () => ({ ipcRenderer: { invoke: (c: string) => invoke(c) } }))

installDom(window)
const tick = () => new Promise((r) => setTimeout(r, 20))

describe('claude settings tab', () => {
  beforeEach(() => invoke.mockClear())

  it('shows the command with the vault path and installs on click', async () => {
    const { claudeSettingsTab } = await import('./claudeSettings.js')
    const tab = claudeSettingsTab({ vault: { adapter: { getBasePath: () => 'D:/Моя тека' } } } as never)
    tab.display()
    await tick()
    const field = tab.containerEl.querySelector<HTMLInputElement>('.claude-cmd__field')!
    expect(field.value).toBe('claude mcp add aether -- node "C:/x/server.js" "D:/Моя тека"')
    ;[...tab.containerEl.querySelectorAll('button')].find((b) => b.textContent === 'Підключити до Claude Desktop')!.click()
    await tick()
    expect(invoke).toHaveBeenCalledWith('claude:install')
    expect(tab.containerEl.querySelector('.claude-status.is-ok')).not.toBeNull()
  })
})
