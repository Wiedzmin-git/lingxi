import { chromium } from "@playwright/test"
import { DEFAULT_THEMES, graphiteSoftTheme, oc2Theme, resolveThemeVariantV2, themeV2ToCss } from "../../ui/src/theme"
import type { DesktopTheme } from "../../ui/src/theme"
import { mkdir, readFile, writeFile } from "node:fs/promises"

const output = process.argv[2]

if (!output) throw new Error("Pass an output directory for verification artifacts")

// Playwright's browser handshake can stall when it runs directly under Bun on Windows.
// Keep the documented Bun entrypoint, but execute the bundled verifier in Node.
if (process.env.GRAPHITE_SOFT_NODE !== "1") {
  const directory = "node_modules/.cache/graphite-soft-verifier"
  await mkdir(directory, { recursive: true })

  const build = await Bun.build({
    entrypoints: [import.meta.path],
    outdir: directory,
    naming: "verify.mjs",
    target: "node",
    packages: "external",
  })

  if (!build.success) throw new AggregateError(build.logs, "Failed to build the GraphiteSoft verifier")

  const subprocess = Bun.spawn(["node", `${directory}/verify.mjs`, output], {
    env: { ...process.env, GRAPHITE_SOFT_NODE: "1" },
    stdout: "inherit",
    stderr: "inherit",
  })

  process.exit(await subprocess.exited)
}

if (DEFAULT_THEMES["graphite-soft"] !== graphiteSoftTheme) throw new Error("GraphiteSoft is not publicly registered")

await mkdir(output, { recursive: true })

const css = await readFile("src/components/message-part.css", "utf8")

// Bun's direct Playwright launch can stall on the separate Windows headless-shell binary.
// Use Playwright's Chromium binary, which is also exercised by the app keeper suite.
const browser = await chromium.launch({ executablePath: chromium.executablePath() })

const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })

const results = []

try {
  for (const mode of ["dark", "light"] as const) {
    const cssFor = (theme: DesktopTheme) => themeV2ToCss(resolveThemeVariantV2(theme[mode], mode === "dark"))

    for (const direction of ["ltr", "rtl"] as const) {
      await page.setContent(`<html data-theme="oc-2" data-color-scheme="${mode}" dir="${direction}" lang="en"><head><style id="theme-tokens">
        :root { ${cssFor(oc2Theme)} --font-family-sans: system-ui; --font-size-base: 15px; --line-height-large: 24px; }
      </style><style>
        body { padding: 32px; background: ${mode === "dark" ? "#0c1116" : "#f5f6f7"}; font-family: system-ui; color: ${mode === "dark" ? "#d6dce1" : "#28323b"}; }
        section { margin-block: 24px; } h1 { font-size: 24px; } h2 { font-size: 15px; font-weight: 400; }
        ${css}
      </style></head><body><h1>GraphiteSoft</h1>
      <section data-local-session><h2>Local session</h2><div data-component="user-message"><div data-slot="user-message-body"><div data-slot="user-message-text" dir="auto">Хочу спокойные пузырьки · <span data-highlight="agent"><span data-slot="user-message-mention-prefix">@</span>explore</span>\nHello · مرحبا · D:\\projects\\app</div></div></div></section>
      <section data-workspace-session><h2>Workspace session</h2><div data-component="user-message"><div data-slot="user-message-body"><div data-slot="user-message-text" dir="auto">Тот же стиль · <span data-highlight="agent"><span data-slot="user-message-mention-prefix">@</span>explore</span>\nA comment with g, j, p, q and y.</div></div></div></section>
      </body></html>`)

      const styles = () =>
        page.locator('[data-slot="user-message-text"]').evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            const mention = element.querySelector('[data-slot="user-message-mention-prefix"]')

            return {
              background: style.backgroundColor,
              color: style.color,
              border: style.borderTopColor,
              radius: style.borderRadius,
              weight: style.fontWeight,
              mention: mention ? getComputedStyle(mention).color : "missing",
            }
          }),
        )

      const apply = (theme: DesktopTheme) =>
        page.evaluate(
          ({ id, tokens }) => {
            const style = document.getElementById("theme-tokens")

            if (!style) throw new Error("Theme token style is missing")
            style.textContent = `:root { ${tokens} --font-family-sans: system-ui; --font-size-base: 15px; --line-height-large: 24px; }`
            document.documentElement.dataset.theme = id
          },
          { id: theme.id, tokens: cssFor(theme) },
        )

      const baseline = await styles()
      await apply(graphiteSoftTheme)
      const actual = await styles()

      const expected =
        mode === "dark"
          ? {
              background: "rgb(32, 38, 43)",
              color: "rgb(214, 220, 225)",
              border: "rgb(48, 57, 64)",
              radius: "12px",
              weight: "400",
              mention: "rgb(154, 182, 207)",
            }
          : {
              background: "rgb(232, 237, 241)",
              color: "rgb(40, 50, 59)",
              border: "rgb(203, 212, 220)",
              radius: "12px",
              weight: "400",
              mention: "rgb(66, 103, 137)",
            }

      if (actual.length !== 2 || actual.some((style) => JSON.stringify(style) !== JSON.stringify(expected))) {
        throw new Error(`${mode}/${direction}: unexpected bubble styles: ${JSON.stringify(actual)}`)
      }

      await page.screenshot({ path: `${output}/graphite-soft-${mode}-${direction}.png` })
      await apply(oc2Theme)
      const other = await styles()

      if (JSON.stringify(other) !== JSON.stringify(baseline)) {
        throw new Error(`GraphiteSoft styles survived theme switch: ${JSON.stringify({ baseline, other })}`)
      }

      results.push({ mode, direction, actual, themeSwitch: "passed" })
    }
  }

  await writeFile(`${output}/verification.json`, JSON.stringify(results, null, 2))
  console.log(
    "Passed: public registry, message styles, mention-prefix contrast, light/dark, synthetic local/workspace placements, direction-invariant colors, and theme-switch isolation",
  )
} finally {
  await browser.close()
}
