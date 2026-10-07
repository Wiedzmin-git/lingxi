import { Project } from "@opencode/schema/project"
import { Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ProjectNotFoundError } from "../errors.js"

const root = "/api/project"
const UpdatePayload = Schema.Struct(Struct.omit(Project.UpdateInput.fields, ["projectID"]))

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.post("project.create", root, {
      payload: Project.CreateInput,
      success: Schema.Struct({ directory: Project.CreateInput.fields.parent }),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.create",
        summary: "Create project directory",
        description: "Create one new child directory in an existing parent and register its owning project. Existing paths are never overwritten.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project.list", root, {
      success: Schema.Array(Project.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.list",
        summary: "List projects",
        description: "List known projects.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("project.update", `${root}/:projectID`, {
      params: { projectID: Project.ID },
      payload: UpdatePayload,
      success: Project.Info,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.update",
        summary: "Update project",
        description: "Update the project canonical directory, display metadata, and workspace commands.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "project",
      description: "Project routes.",
    }),
  )
