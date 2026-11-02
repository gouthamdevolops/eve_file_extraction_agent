import { defineChannel, GET, POST } from "eve/channels";
import { getRunStatus, receiveUpload } from "../lib/upload-api.js";
import {
  createWorkspaceResponse,
  getWorkspaceStatus,
  startWorkspaceProcess,
  uploadWorkspaceFile,
} from "../lib/workspace.js";

export default defineChannel({
  routes: [
    GET("/health", async () => Response.json({ status: "ok" })),
    POST("/workspace", (request) => createWorkspaceResponse(request)),
    POST("/workspace/:sessionId/uploads", (request, context) => uploadWorkspaceFile(request, context.params.sessionId ?? "")),
    POST("/workspace/:sessionId/process", (request, context) => startWorkspaceProcess(context.params.sessionId ?? "", context.from, context.waitUntil)),
    GET("/workspace/:sessionId", (_request, context) => getWorkspaceStatus(context.params.sessionId ?? "")),
    GET("/api/runs/:runId", (_request, context) => getRunStatus(context.params.runId ?? "")),
    POST("/api/runs", (request, context) => receiveUpload(request, context.from, context.waitUntil)),
  ],
});
