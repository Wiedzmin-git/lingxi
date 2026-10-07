import { describe, expect, test } from "bun:test"
import {
  clampSessionContentWidth,
  clampSessionPanelWidth,
  SESSION_CONTENT_WIDTH_GUTTER,
  SESSION_CONTENT_WIDTH_MIN,
  sessionContentWidthMax,
} from "./session-panel-width"

test.each([
  ["keeps widths already within the limit", 800, 1700, false, 800],
  ["reserves the unified review pane minimum", 1600, 1700, false, 1220],
  ["reserves a larger minimum for split diffs", 1600, 1700, true, 900],
  // Regression: the old cap was 45% of the window, forcing the review pane to at least 55%.
  ["lets the chat panel take everything beyond the review pane minimum", 3440, 3440, false, 2960],
  ["holds the chat panel minimum when there is no room for both", 1600, 700, true, 450],
  ["never drops below the chat panel minimum on small windows", 1600, 0, false, 450],
  ["skips clamping before the layout is measured", 1600, undefined, false, 1600],
])("%s", (_name, width, available, split, expected) => {
  expect(clampSessionPanelWidth({ width, available, split })).toBe(expected)
})

describe("session content width", () => {
  test("keeps the resize handles clear of the panel edges", () => {
    expect(sessionContentWidthMax(1920)).toBe(1920 - SESSION_CONTENT_WIDTH_GUTTER)
    expect(sessionContentWidthMax(450)).toBe(450 - SESSION_CONTENT_WIDTH_GUTTER)
  })

  test.each([
    ["clamps a saved width when the window shrinks", 1800, 1200, 1200 - SESSION_CONTENT_WIDTH_GUTTER],
    ["restores the saved width when space is available", 1400, 1920, 1400],
    ["enforces the content minimum", 200, 1920, SESSION_CONTENT_WIDTH_MIN],
    ["keeps the gutter when the panel is narrower than the resize minimum", 900, 460, 436],
    ["keeps the stored width before measurement", 1400, undefined, 1400],
  ])("%s", (_name, width, available, expected) => {
    expect(clampSessionContentWidth({ width, available })).toBe(expected)
  })
})
