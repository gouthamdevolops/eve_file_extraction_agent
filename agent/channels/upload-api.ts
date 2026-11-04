import { defineChannel, DELETE, GET, POST } from "eve/channels";
import { getRunStatus, receiveUpload } from "../lib/upload-api.js";
import {
  createWorkspaceResponse,
  deleteWorkspace,
  deleteWorkspaceFile,
  getWorkspaceStatus,
  listWorkspaces,
  startWorkspaceProcess,
  uploadWorkspaceFile,
} from "../lib/workspace.js";

export default defineChannel({
  routes: [
    GET("/health", async () => Response.json({ status: "ok" })),
    GET("/workspace", (request) => listWorkspaces(request)),
    POST("/workspace", (request) => createWorkspaceResponse(request)),
    POST("/workspace/:sessionId/uploads", (request, context) => uploadWorkspaceFile(request, context.params.sessionId ?? "")),
    DELETE("/workspace/:sessionId/uploads", (request, context) => deleteWorkspaceFile(context.params.sessionId ?? "", new URL(request.url).searchParams.get("filename") ?? "")),
    DELETE("/workspace/:sessionId", (_request, context) => deleteWorkspace(context.params.sessionId ?? "")),
    POST("/workspace/:sessionId/process", (request, context) => startWorkspaceProcess(context.params.sessionId ?? "", context.from, context.waitUntil)),
    GET("/workspace/:sessionId", (_request, context) => getWorkspaceStatus(context.params.sessionId ?? "")),
    GET("/api/runs/:runId", (_request, context) => getRunStatus(context.params.runId ?? "")),
    POST("/api/runs", (request, context) => receiveUpload(request, context.from, context.waitUntil)),
  ],
});
