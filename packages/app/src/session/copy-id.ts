import { showToast } from "@opencode/ui/toast"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"

/** The selected row/tab owns the ID; never resolve it through the active route. */
export function useCopySessionID() {
  const platform = usePlatform()
  const language = useLanguage()
  return async (sessionID: string) => {
    try {
      await (platform.writeClipboardText?.(sessionID) ?? navigator.clipboard.writeText(sessionID))
      showToast({ variant: "success", icon: "circle-check", title: language.t("common.copied"), description: sessionID })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("toast.session.copyID.failed.title"),
        description: error instanceof Error ? error.message : language.t("toast.session.copyID.failed.description"),
      })
    }
  }
}
