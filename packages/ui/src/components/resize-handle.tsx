import { onCleanup, splitProps, type JSX } from "solid-js"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onCollapse?: () => void
  /** Called while dragging when size crosses `collapseThreshold`. */
  onCollapseChange?: (collapsed: boolean) => void
  collapseThreshold?: number
  keyboardStep?: number
  onReset?: () => void
  onResizeStart?: () => void
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "onResize",
    "onCollapse",
    "onCollapseChange",
    "collapseThreshold",
    "keyboardStep",
    "onReset",
    "onResizeStart",
    "onPointerDown",
    "onKeyDown",
    "class",
    "classList",
  ])

  let stopDrag = () => {}

  const handlePointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    invokeHandler(local.onPointerDown, e)
    if (e.defaultPrevented) return
    if (e.button !== 0) return
    if (e.detail > 1) return
    e.preventDefault()
    stopDrag()
    local.onResizeStart?.()
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const start = local.direction === "horizontal" ? e.clientX : e.clientY
    const rtl =
      local.direction === "horizontal" &&
      e.currentTarget instanceof Element &&
      getComputedStyle(e.currentTarget).direction === "rtl"
    const startSize = local.size
    const min = local.min
    const max = local.max
    const threshold = local.collapseThreshold ?? 0
    const onResize = local.onResize
    const onCollapse = local.onCollapse
    const onCollapseChange = local.onCollapseChange
    let current = startSize
    let collapsed = false
    const userSelect = document.body.style.userSelect
    const overflow = document.body.style.overflow
    const target = e.currentTarget

    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    target.setPointerCapture(e.pointerId)

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== e.pointerId) return
      const pos = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
      const delta =
        local.direction === "vertical"
          ? edge === "end"
            ? pos - start
            : start - pos
          : (edge === "start") !== rtl
            ? start - pos
            : pos - start
      current = startSize + delta
      const nextCollapsed = threshold > 0 && current < threshold
      if (nextCollapsed !== collapsed) {
        collapsed = nextCollapsed
        onCollapseChange?.(collapsed)
      }
      onResize(Math.min(max, Math.max(min, current)))
    }

    const cleanup = () => {
      document.body.style.userSelect = userSelect
      document.body.style.overflow = overflow
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
      document.removeEventListener("pointercancel", onPointerCancel)
      window.removeEventListener("blur", cancel)
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
      stopDrag = () => {}
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return
      cleanup()
      if (collapsed) {
        onCollapse?.()
        return
      }
      onCollapseChange?.(false)
    }

    const cancel = () => {
      cleanup()
      onCollapseChange?.(false)
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return
      cancel()
    }

    stopDrag = cancel
    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
    document.addEventListener("pointercancel", onPointerCancel)
    window.addEventListener("blur", cancel)
  }

  const handleKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (e) => {
    invokeHandler(local.onKeyDown, e)
    if (e.defaultPrevented) return
    const step = local.keyboardStep
    if (!step) return
    if (e.key === "Enter" && local.onReset) {
      e.preventDefault()
      local.onReset()
      return
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault()
      local.onResize(e.key === "Home" ? local.min : local.max)
      return
    }
    const movement =
      local.direction === "horizontal"
        ? e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowRight"
            ? 1
            : 0
        : e.key === "ArrowUp"
          ? -1
          : e.key === "ArrowDown"
            ? 1
            : 0
    if (!movement) return
    e.preventDefault()
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const rtl =
      local.direction === "horizontal" &&
      e.currentTarget instanceof Element &&
      getComputedStyle(e.currentTarget).direction === "rtl"
    const delta =
      local.direction === "vertical"
        ? edge === "end"
          ? movement
          : -movement
        : (edge === "start") !== rtl
          ? -movement
          : movement
    local.onResize(Math.min(local.max, Math.max(local.min, local.size + delta * step * (e.shiftKey ? 5 : 1))))
  }

  onCleanup(() => stopDrag())

  return (
    <div
      {...rest}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={local.edge ?? (local.direction === "vertical" ? "start" : "end")}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  )
}

function invokeHandler<E extends Event>(
  handler: JSX.EventHandlerUnion<HTMLDivElement, E> | undefined,
  event: E & { currentTarget: HTMLDivElement; target: Element },
) {
  if (typeof handler === "function") {
    handler(event)
    return
  }
  handler?.[0](handler[1], event)
}
