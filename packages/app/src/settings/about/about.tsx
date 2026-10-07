import { Wordmark } from "@opencode/ui/wordmark"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"

export function SettingsAbout(_props: { active: boolean }) {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <div class="settings-about-content">
      <Wordmark class="w-full max-w-[480px]" fade={false} muted={false} />
      <div class="settings-about-intro">
        <p>{language.t("settings.about.version", { version: platform.version ?? language.t("settings.about.devVersion") })}</p>
        <p>{language.t("settings.about.license")}</p>
      </div>
      <p>{language.t("settings.about.lingxiDescription")}</p>
      <ExternalLink href="https://github.com/Wiedzmin-git/lingxi">github.com/Wiedzmin-git/lingxi</ExternalLink>
      <div class="settings-about-details">
        <p>{language.t("settings.about.upstreamCredit")}</p>
        <ExternalLink href="https://github.com/anomalyco/opencode/graphs/contributors">OpenCode</ExternalLink>
        <p>{language.t("settings.about.trademark")}</p>
      </div>
    </div>
  )
}
