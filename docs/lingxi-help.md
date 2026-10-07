# Lingxi · 靈犀

Lingxi is an independent fork of OpenCode V2. Report Lingxi defects and suggestions in
[Lingxi Issues](https://github.com/Wiedzmin-git/lingxi/issues). The Help menu can export
diagnostic logs. Review exported logs before attaching them to a public issue.

## Providers

Open Settings → Providers to connect a model provider. Select its supported sign-in
method or supply that provider's API key. For an OpenAI-compatible custom provider,
use its documented base URL and model identifiers. Lingxi release-access keys only
download private releases; they are not model-provider credentials.

OpenCode Console/Go/Zen remain separately operated model-provider services; their
names and account links identify those services, not Lingxi support.

## Appearance

Settings → Appearance controls the theme, color scheme and fonts. Settings → General
controls horizontal or vertical session tabs. New Lingxi profiles use GraphiteSoft and vertical tabs;
an existing saved preference is retained. The small Lingxi mark is reserved for a
future easter egg and currently does not change the layout.

## Skills

Skills provide reusable task instructions. View available skills in Settings →
Extensions or a project's extension settings. Lingxi retains the OpenCode V2 skill
format: a skill directory contains `SKILL.md` with its name, description and body.
For the inherited format and discovery rules, consult the explicitly upstream
[OpenCode V2 documentation](https://opencode.ai/v2/docs/skills).

## Updates

Private Desktop builds are distributed through the independent Lingxi launcher.
The titlebar offers available updates automatically. Click to download, follow the
progress, then close Lingxi when convenient and open it normally. **Stage updates**
also shows download progress. Staging does not replace a running Desktop.
Dev and stable are channels of the same installation and profile.

For the first upgrade from dev.1/dev.2 to dev.3, run the new installer in the existing
installation directory and launch through its updated Start Menu shortcut. It adds
the in-app updater and the matching recovery-capable launcher, preserving your profile.
The initial Session Link upgrade restarts the profile's backend if no active work is
observed. Later input may be interrupted and recovered; this is not an atomic idle barrier.

## Permissions and branch messages

New profiles enable the native **Auto-approve permissions** switch, including tools
that run commands. Change it in Settings → General. Existing saved settings take precedence.

Branch messages use two sending modes locally and for colleagues: ordinary `wake`
(the default) starts an idle recipient or waits behind current work; `steer` starts
an idle recipient or enters at the next safe step boundary. Historical parked queue
items retain their identities and original delivery semantics.

## Attribution

Lingxi is based on OpenCode; its original copyright and MIT license remain included.
The name 靈犀 is inspired by Li Shangyin's line 心有靈犀一點通. Our human–AI reading is
a modern interpretation of that line, not a claim about the original poem's subject.
