// The review pane has no width of its own: it takes whatever the chat panel
// leaves behind. Instead of capping the chat panel at a fraction of the window
// (which forces the review pane to grow with the monitor), reserve a fixed
// minimum for the review pane and let the chat panel take everything else.
export const SESSION_PANEL_WIDTH_MIN = 450
const REVIEW_PANE_WIDTH_MIN = 480
const REVIEW_PANE_WIDTH_MIN_SPLIT = 800
export const SESSION_CONTENT_WIDTH_MIN = 450
export const SESSION_CONTENT_WIDTH_DEFAULT = 800
export const SESSION_CONTENT_WIDTH_DEFAULT_WIDE = 1000
export const SESSION_CONTENT_WIDTH_GUTTER = 24

export function sessionPanelWidthMax(input: { available: number; split: boolean }) {
  const pane = input.split ? REVIEW_PANE_WIDTH_MIN_SPLIT : REVIEW_PANE_WIDTH_MIN
  return Math.max(SESSION_PANEL_WIDTH_MIN, input.available - pane)
}

// `available` is undefined until the layout row is first measured; render the
// stored width untouched until then to avoid a first-frame snap.
export function clampSessionPanelWidth(input: { width: number; available: number | undefined; split: boolean }) {
  if (input.available === undefined) return input.width
  return Math.min(input.width, sessionPanelWidthMax({ available: input.available, split: input.split }))
}

export function sessionContentWidthMax(available: number) {
  return Math.max(0, available - SESSION_CONTENT_WIDTH_GUTTER)
}

export function clampSessionContentWidth(input: { width: number; available: number | undefined }) {
  const width = Math.max(SESSION_CONTENT_WIDTH_MIN, input.width)
  if (input.available === undefined) return width
  // The gutter wins when a side panel leaves less room than the resize minimum.
  // The stored preference remains unchanged and returns when space is available.
  return Math.min(width, sessionContentWidthMax(input.available))
}
