import { Project } from "@opencode/core/project"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError, ProjectNotFoundError } from "@opencode/protocol/errors"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  handlers
    .handle("project.create", (ctx) =>
      Project.Service.use((project) =>
        project.create(ctx.payload).pipe(Effect.mapError((error) => new InvalidRequestError({ message: error.message }))),
      ),
    )
    .handle("project.list", () => Project.Service.use((project) => project.list()))
    .handle("project.update", (ctx) =>
      Project.Service.use((project) =>
        project.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
          Effect.mapError(
            () =>
              new ProjectNotFoundError({
                projectID: ctx.params.projectID,
                message: `Project not found: ${ctx.params.projectID}`,
              }),
          ),
        ),
      ),
    ),
)
