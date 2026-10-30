import { defineChannel, GET, POST } from "eve/channels";
import { getRunStatus, receiveUpload } from "../lib/upload-api.js";

export default defineChannel({
  routes: [
    GET("/health", async () => Response.json({ status: "ok" })),
    GET("/api/runs/:runId", (_request, context) => getRunStatus(context.params.runId ?? "")),
    POST("/api/runs", (request, context) => receiveUpload(request, context.from, context.waitUntil)),
  ],
});
