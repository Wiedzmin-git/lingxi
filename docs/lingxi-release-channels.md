# Private Lingxi Desktop channels

Release bytes live in `Wiedzmin-git/lingxi-releases`, separately from public source.
Each immutable release has its own tag, ZIP asset and installer. Do not replace an
asset under an already issued release identity; publish a new release instead.

The launcher's fixed discovery tags are `lingxi-channel-dev` and
`lingxi-channel-stable`. Each contains one `channel.json` asset:

```json
{
  "format": 1,
  "channel": "dev",
  "releaseId": "<exact bundle releaseId>",
  "archiveAssetId": 123,
  "archiveSha256": "<64 hexadecimal characters>",
  "archiveBytes": 123
}
```

The asset ID addresses the ZIP from the immutable release in the same repository.
It is not the installer ID or a browser-download URL. The launcher checks archive
size and SHA-256, each inventory entry, and equality of bundle/channel release IDs.
Credentials are sent to GitHub's API only, not to the signed asset redirect.

## Publish dev

1. Build and test the precise Desktop and launcher intended for delivery. Keep
   the upstream, Electron and .NET licenses/notices with their corresponding bytes.
2. Author the ZIP once; record its digest, byte count, compatibility evidence and
   source commit. Build the initial NSIS installer around that exact ZIP.
3. Exercise installed launch, active staging and preservation in isolated profiles.
4. Upload the installer and ZIP under a new immutable development release tag.
   Read asset metadata back, download the ZIP, and verify the retained digest.
5. Publish the dev channel manifest with the read-back ZIP asset ID. Check a real
   launcher's Credential Manager → private download → candidate admission path.
   That acceptance is distinct from upload/download through GitHub CLI.

Replacing a channel manifest can briefly make discovery unavailable. It must
never affect the current running Desktop or discard the last accepted bundle.

## Promote stable

Stable promotion points to the **same ZIP asset ID, release ID, digest and bytes**
that passed dev acceptance. Only the channel field and channel discovery release
change. Do not rebuild, re-sign, re-zip or silently patch the tested bundle. Source
branch names alone do not establish a stable installer or stable runtime.

Channel choice belongs to one installation, with one exact profile descriptor.
Changing channels must not create another profile, reinitialize installation state,
reset a recovery episode, or bypass the activation compatibility gate. R1 permits
changed Desktop bytes only with the same declared storage contract and the exact
same backend version as the current bundle. A release changing either coordinate
can be downloaded but is refused before process creation, without fallback. This
is a conservative no-migration boundary, not support for cross-version rollback.
The release author must establish the declared contract through acceptance. Use
`Lingxi.Launcher channel <installation-root> <dev|stable>`, then `stage`. The command
clears a different-channel pending candidate and preserves current Desktop and
recovery state; it refuses to race a download. Channel UI is not included yet.

## Individual access

For the personally owned release repository, issue separate owner-created
fine-grained credentials restricted to this repository and Contents: read-only.
Name and expire each credential for its recipient; revocation is independent.
Requests retain the issuing account's GitHub identity, not the recipient's identity.
Never distribute the author's GitHub CLI credential or a classic write-capable PAT.

Recipients enter their credential locally with `Lingxi.Launcher credential`.
The value is saved under `Lingxi:github:Wiedzmin-git/lingxi-releases` in Windows
Credential Manager. Do not put tokens in channel files, installers, command-line
arguments, renderer state, logs or conversations.
