// Only these copy keys name the application. Provider names, backend compatibility,
// command syntax and upstream attribution retain their own identities. Apply before
// interpolation so user-supplied names and errors are never rewritten.
const applicationKeys = new Set([
  "desktop.menu.app",
  "desktop.menu.documentation",
  "desktop.menu.ariaLabel",
  "desktop.recovery.loadFailed",
  "desktop.recovery.terminated",
  "desktop.recovery.unresponsive",
  "provider.connect.apiKey.description",
  "provider.connect.chatgptWelcome.description",
  "error.page.report.prefix",
  "error.chain.mcpFailed",
  "settings.general.row.language.description",
  "settings.general.row.colorScheme.description",
  "settings.general.row.theme.description",
  "project.settings.name.description",
  "project.settings.extensions.empty.mcps.title",
  "project.settings.extensions.empty.mcps.description",
  "project.settings.extensions.empty.plugins.title",
  "project.settings.extensions.empty.plugins.description",
  "project.settings.extensions.empty.skills.title",
  "project.settings.extensions.empty.skills.description",
  "settings.workspaces.empty.description",
])

export function brandedMessage(key: string, value: string) {
  return applicationKeys.has(key) ? value.replaceAll("OpenCode", "Lingxi") : value
}

export function brandedDictionary<T extends Record<string, string>>(source: T): T {
  return Object.assign(
    {},
    source,
    Object.fromEntries(Object.entries(source).map(([key, value]) => [key, brandedMessage(key, value)])),
  )
}
