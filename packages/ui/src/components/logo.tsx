import { type ComponentProps } from "solid-js"
import { Wordmark } from "../typography/wordmark/wordmark"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M30 78C8 48 41 16 66 36M98 50C120 80 87 112 62 92" stroke="var(--icon-strong-base)" stroke-width="10" stroke-linecap="round" />
      <path d="M64 42L70 58L86 64L70 70L64 86L58 70L42 64L58 58Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M30 78C8 48 41 16 66 36M98 50C120 80 87 112 62 92" stroke="var(--icon-strong-base)" stroke-width="10" stroke-linecap="round" />
      <path d="M64 42L70 58L86 64L70 70L64 86L58 70L42 64L58 58Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return <Wordmark class={props.class} fade={false} muted={false} />
}
