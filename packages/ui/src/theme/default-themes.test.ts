import { expect, test } from "bun:test"
import { DEFAULT_THEMES, graphiteSoftTheme } from "./default-themes"

test("the public built-in catalogue exposes GraphiteSoft", () => {
  expect(DEFAULT_THEMES["graphite-soft"]).toBe(graphiteSoftTheme)
  expect(graphiteSoftTheme).toMatchObject({ id: "graphite-soft", name: "GraphiteSoft" })
})
