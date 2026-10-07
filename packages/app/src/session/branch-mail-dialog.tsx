import { For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { type Contact, type Mail, type SessionLinkRequest, type SessionLinkResult } from "@/runtime/platform/session-link"
import type { Schema } from "effect"
import { useQueryClient } from "@tanstack/solid-query"
import "./branch-mail-dialog.css"

const stages = {
  outgoing: "branchMail.stage.outgoing", unknown: "branchMail.stage.unknown", refused: "branchMail.stage.refused",
  accepted: "branchMail.stage.accepted", node_saved: "branchMail.stage.node", retry_expired: "branchMail.stage.expired",
  cancelled: "branchMail.stage.cancelled", processing: "branchMail.stage.processing", completed: "branchMail.stage.completed",
  blocked: "branchMail.stage.blocked",
  failed: "branchMail.stage.failed", interrupted: "branchMail.stage.interrupted", replied: "branchMail.stage.replied",
  outcome_unknown: "branchMail.stage.outcomeUnknown",
} as const

export function BranchMailDialog(props: { server: string; sessionID: string; title: string }) {
  const language = useLanguage()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    busy: false, error: "", copied: false, listener: "", enabled: false, host: "", publishHost: "", port: "58321", networks: "", ports: "58321", retryHours: "24",
    wake: false, wakeDirty: false, addressActive: false, currentWake: false,
    invitation: "", label: "", contact: "", text: "", mode: "queue" as "wake" | "queue" | "steer",
    relation: undefined as Mail["inReplyTo"] | undefined,
    contacts: [] as Schema.Schema.Type<typeof Contact>[], mail: [] as Mail[],
  })
  let disposed = false
  const call = async (request: Omit<SessionLinkRequest, "server" | "sessionID">): Promise<SessionLinkResult> => {
    if (!platform.sessionLink) return { error: "r2_host_unavailable" }
    return await platform.sessionLink({ ...request, server: props.server, sessionID: props.sessionID })
  }
  const refresh = async (initial = false) => {
    const [status, contacts, mail] = await Promise.all([call({ operation: "status" }), call({ operation: "contacts" }), call({ operation: "mail" })])
    if (disposed) return
    const error = status.error ?? contacts.error ?? mail.error
    if (error) { setState("error", error); return }
    setState({ listener: status.listener ?? "", contacts: [...(contacts.contacts ?? [])], mail: [...(mail.mail ?? [])] })
    if (status.branchAddress) {
      setState({ addressActive: status.branchAddress.active, currentWake: status.branchAddress.wake })
      if (initial || !state.wakeDirty) setState("wake", status.branchAddress.wake)
    }
    if (initial && status.config) setState({ enabled: status.config.enabled, host: status.config.host, publishHost: status.config.publishHost ?? "", port: String(status.config.port),
      networks: status.config.outgoingNetworks.join(", "), ports: status.config.outgoingPorts.join(", "), retryHours: String(status.config.retryHours) })
  }
  const action = async (request: Omit<SessionLinkRequest, "server" | "sessionID">) => {
    if (state.busy) return
    setState({ busy: true, error: "", copied: false })
    try {
      const result = await call(request)
      if (result.error) { setState("error", result.error); return }
      if (["configure", "copy-address", "issue-address", "revoke-address", "set-wake"].includes(request.operation)) {
        // Listener configuration affects every branch; a branch grant affects
        // only its exact server/ID. CLI changes are observed by interval refresh.
        void queryClient.invalidateQueries({ queryKey: request.operation === "configure"
          ? ["branch-mail-status"] : ["branch-mail-status", props.server, props.sessionID] })
      }
      if (result.copied) setState("copied", true)
      if (request.operation === "import-contact") setState({ invitation: "", label: "" })
      if (request.operation === "send") setState({ text: "", relation: undefined })
      if (["copy-address", "issue-address", "revoke-address", "set-wake"].includes(request.operation)) setState("wakeDirty", false)
      await refresh()
    } catch { setState("error", "r2_unavailable") }
    finally { if (!disposed) setState("busy", false) }
  }
  onMount(() => {
    void refresh(true).catch(() => setState("error", "r2_unavailable"))
    const timer = setInterval(() => { if (!state.busy) void refresh().catch(() => setState("error", "r2_unavailable")) }, 2500)
    onCleanup(() => { disposed = true; clearInterval(timer) })
  })
  return (
    <Dialog fit containerClass="branch-mail-dialog">
      <DialogHeader><DialogTitle>{language.t("branchMail.title", { title: props.title })}</DialogTitle></DialogHeader>
      <DialogBody class="flex min-w-0 flex-col gap-4 px-4 py-4 text-[13px] leading-5">
        <p>{language.t("branchMail.consultation")}</p>
        <p role="status">{language.t("branchMail.listener", { status: state.listener })}</p>
        <details>
          <summary>{language.t("branchMail.networkSettings")}</summary>
          <div class="mt-3 flex flex-col gap-2">
            <p>{language.t("branchMail.noTLS")}</p>
            <label><input type="checkbox" checked={state.enabled} onChange={(event) => setState("enabled", event.currentTarget.checked)} /> {language.t("branchMail.enable")}</label>
            <label>{language.t("branchMail.bind")}<TextInput value={state.host} onInput={(event) => setState("host", event.currentTarget.value)} /></label>
            <label>{language.t("branchMail.publishHost")}<TextInput value={state.publishHost} onInput={(event) => setState("publishHost", event.currentTarget.value)} /></label>
            <label>{language.t("branchMail.port")}<TextInput value={state.port} onInput={(event) => setState("port", event.currentTarget.value)} /></label>
            <label>{language.t("branchMail.networks")}<TextInput value={state.networks} onInput={(event) => setState("networks", event.currentTarget.value)} /></label>
            <label>{language.t("branchMail.ports")}<TextInput value={state.ports} onInput={(event) => setState("ports", event.currentTarget.value)} /></label>
            <label>{language.t("branchMail.retryHours")}<TextInput value={state.retryHours} onInput={(event) => setState("retryHours", event.currentTarget.value)} /></label>
            <Button disabled={state.busy} onClick={() => void action({ operation: "configure", config: { enabled: state.enabled, host: state.host.trim(), ...(state.publishHost.trim() ? { publishHost: state.publishHost.trim() } : {}), port: Number(state.port),
              outgoingNetworks: state.networks.split(",").map((value) => value.trim()).filter(Boolean), outgoingPorts: state.ports.split(",").map(Number), retryHours: Number(state.retryHours) } })}>{language.t("common.save")}</Button>
          </div>
        </details>
        <section class="flex flex-col gap-2">
          <h3>{language.t("branchMail.address")}</h3>
          <p>{language.t("branchMail.privateAddress")}</p>
          <p role="status">{language.t(!state.addressActive ? "branchMail.addressInactive" : state.currentWake ? "branchMail.currentWakeAllowed" : "branchMail.currentWakeDenied")}</p>
          <label><input type="checkbox" checked={state.wake} onChange={(event) => setState({ wake: event.currentTarget.checked, wakeDirty: true })} /> {language.t("branchMail.wake")}</label>
          <div class="flex flex-wrap gap-2">
            <Button disabled={state.busy} onClick={() => void action({ operation: "copy-address", wake: state.wake })}>{language.t("branchMail.copyAddress")}</Button>
            <Button disabled={state.busy} onClick={() => void action({ operation: "issue-address", wake: state.wake })}>{language.t("branchMail.reissue")}</Button>
            <Button disabled={state.busy || !state.addressActive} onClick={() => void action({ operation: "set-wake", wake: state.wake })}>{language.t("branchMail.applyWake")}</Button>
            <Button disabled={state.busy} onClick={() => void action({ operation: "revoke-address" })}>{language.t("branchMail.revoke")}</Button>
          </div>
          <Show when={state.copied}><p role="status">{language.t("branchMail.addressCopied")}</p></Show>
        </section>
        <section class="flex flex-col gap-2">
          <h3>{language.t("branchMail.contacts")}</h3>
          <label>{language.t("branchMail.contactLabel")}<TextInput value={state.label} onInput={(event) => setState("label", event.currentTarget.value)} /></label>
          <label>{language.t("branchMail.invitation")}<textarea class="min-h-16 w-full rounded border p-2" value={state.invitation} autocomplete="off"
            onInput={(event) => setState("invitation", event.currentTarget.value)} /></label>
          <Button disabled={state.busy || !state.invitation.trim() || !state.label.trim()} onClick={() => void action({ operation: "import-contact", invitation: state.invitation.trim(), label: state.label.trim() })}>{language.t("branchMail.import")}</Button>
          <For each={state.contacts}>{(contact) => <div class="flex min-w-0 items-center gap-2"><span class="flex-1 break-all" title={contact.addressRef}>{contact.label} · {contact.target.sessionID}</span>
            <Button disabled={state.busy} onClick={() => void action({ operation: "remove-contact", addressRef: contact.addressRef })}>{language.t("branchMail.removeContact")}</Button></div>}</For>
        </section>
        <section class="flex flex-col gap-2">
          <label>{language.t("branchMail.to")}<select aria-label={language.t("branchMail.to")} class="w-full rounded border p-2" value={state.contact} onChange={(event) => setState("contact", event.currentTarget.value)}>
            <option value="">{language.t("branchMail.chooseContact")}</option>
            <For each={state.contacts}>{(contact) => <option value={contact.addressRef}>{contact.label} · {contact.target.sessionID}</option>}</For>
          </select></label>
          <label>{language.t("branchMail.mode")}<select aria-label={language.t("branchMail.mode")} value={state.mode} onChange={(event) => setState("mode", event.currentTarget.value as "wake" | "queue" | "steer")}>
            <For each={["queue", "wake", "steer"] as const}>{(mode) => <option value={mode}>{language.t(`branchMail.mode.${mode}`)}</option>}</For>
          </select></label>
          <Show when={state.relation}><p>{language.t("branchMail.replyRelation", { id: state.relation?.messageID ?? "" })}</p></Show>
          <label>{language.t("branchMail.message")}<textarea class="min-h-24 w-full rounded border p-2" value={state.text} onInput={(event) => setState("text", event.currentTarget.value)} /></label>
          <Button disabled={state.busy || !state.contact || !state.text.trim()} onClick={() => void action({ operation: "send", message: { addressRef: state.contact, text: state.text,
            mode: state.mode, messageID: `msg_${crypto.randomUUID()}`, ...(state.relation ? { inReplyTo: state.relation } : {}) } })}>{language.t("branchMail.send")}</Button>
        </section>
        <section class="flex flex-col gap-3">
          <h3>{language.t("branchMail.mail")}</h3>
          <p>{language.t("branchMail.receiptBoundary")}</p>
          <For each={state.mail}>{(mail) => <article class="flex min-w-0 flex-col gap-1 rounded border p-2">
            <header>{language.t(mail.kind === "inbox" ? "branchMail.incoming" : "branchMail.outgoing")} · {mail.source.computer} · {mail.source.user} · {mail.source.title}</header>
            <b>{language.t(stages[mail.status as keyof typeof stages] ?? "branchMail.stage.unknown")}</b>
            <Show when={mail.replyKey}><b>{language.t("branchMail.stage.replied")}</b></Show>
            <p class="whitespace-pre-wrap break-words">{mail.text}</p>
            <details><summary>{language.t("branchMail.details")}</summary>
              <dl class="break-all"><dt>{language.t("branchMail.identity")}</dt><dd>{mail.source.installationID} / {mail.source.sessionID} / {mail.messageID}</dd>
                <dt>{language.t("branchMail.to")}</dt><dd>{mail.target.installationID} / {mail.target.sessionID}</dd>
                <dt>{language.t("branchMail.sentAt")}</dt><dd>{new Date(mail.sentAt).toLocaleString()}</dd>
                <Show when={mail.receivedAt}><dt>{language.t("branchMail.receivedAt")}</dt><dd>{new Date(mail.receivedAt!).toLocaleString()}</dd></Show>
                <Show when={mail.observedIP}><dt>{language.t("branchMail.observedIP")}</dt><dd>{mail.observedIP}</dd></Show>
                <dt>{language.t("branchMail.mode")}</dt><dd>{mail.mode}</dd>
                <Show when={mail.inReplyTo}><dt>{language.t("branchMail.replyRelation", { id: mail.inReplyTo!.messageID })}</dt><dd>{mail.inReplyTo!.installationID} / {mail.inReplyTo!.sessionID}</dd></Show>
              </dl>
              <For each={mail.attachments}>{(file) => <p class="break-all">{file.name} · {file.size} · {file.sha256}</p>}</For>
              <Show when={mail.code}><p>{language.t("branchMail.error", { code: mail.code! })}</p></Show>
            </details>
            <div class="flex gap-2">
              <Show when={mail.kind === "inbox" && mail.replyToAddressRef}><Button onClick={() => setState({ contact: mail.replyToAddressRef!, relation: {
                installationID: mail.source.installationID, sessionID: mail.source.sessionID, messageID: mail.messageID } })}>{language.t("branchMail.reply")}</Button></Show>
              <Show when={mail.kind === "outbox" && (mail.admissionStatus !== "accepted" || (mail.mode !== "queue" && !mail.wakeAdvised))}><Button disabled={state.busy} onClick={() => void action({ operation: "retry", mailKey: mail.mailKey })}>{language.t("branchMail.retry")}</Button></Show>
              <Show when={mail.kind === "outbox" && mail.admissionStatus !== "accepted"}><Button disabled={state.busy} onClick={() => void action({ operation: "cancel", mailKey: mail.mailKey })}>{language.t("common.cancel")}</Button></Show>
            </div>
          </article>}</For>
        </section>
        <Show when={state.error}><p role="alert">{language.t("branchMail.error", { code: state.error })}</p></Show>
      </DialogBody>
    </Dialog>
  )
}
