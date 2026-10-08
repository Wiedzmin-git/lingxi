import { ScrollView } from "@opencode/ui/scroll-view"
import { createHomeController } from "./model"
import { createHomeProjectsController } from "./projects/controller"
import { HomeProjects } from "./projects/region"
import { createHomeScrollController } from "./scroll"
import { createHomeSessionSearchController } from "./sessions/search"
import { createHomeSessionsController } from "./sessions/controller"
import { HomeSessions } from "./sessions/region"

export function SessionHistory() {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)

  return (
    <div class="flex min-h-0 flex-1 flex-col self-stretch overflow-hidden">
        <div class="relative z-40 -mb-3 shrink-0 px-3 pt-3">
          <HomeProjects projects={projects} scroll={scroll} dropdown />
        </div>
      <ScrollView
        class="min-h-0 flex-1 [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack()}
        thumbHoverTarget={scroll.viewport.hoverTarget()}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
        onWheel={scroll.viewport.containOuterWheel}
      >
        <div
          class="mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[minmax(0,1fr)] px-3"
        >
          <HomeSessions sessions={sessions} search={search} scroll={scroll} />
        </div>
      </ScrollView>
    </div>
  )
}
