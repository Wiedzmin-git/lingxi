import os from "os"
import path from "path"
import { profileBinding } from "./profile-binding.js"

const home = os.homedir()
const data =
  profileBinding?.dataHome ?? (process.env.XDG_DATA_HOME || (home ? path.join(home, ".local", "share") : undefined))
const cache =
  profileBinding?.cacheHome ?? (process.env.XDG_CACHE_HOME || (home ? path.join(home, ".cache") : undefined))
const config =
  profileBinding?.configHome ?? (process.env.XDG_CONFIG_HOME || (home ? path.join(home, ".config") : undefined))
const state =
  profileBinding?.stateHome ?? (process.env.XDG_STATE_HOME || (home ? path.join(home, ".local", "state") : undefined))

/** The XDG base directories that root opencode's global paths. */
export function roots(app: string) {
  return {
    data: path.join(data!, app),
    cache: path.join(cache!, app),
    config: path.join(config!, app),
    state: path.join(state!, app),
    tmp: path.join(os.tmpdir(), app),
  }
}
