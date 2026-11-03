import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UploadWorkspace from "@/components/upload-workspace";
import WorkspaceMonitor from "@/components/workspace-monitor";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function file(name: string, path?: string) {
  const value = new File(["pdf contents"], name, { type: "application/pdf" });
  if (path) Object.defineProperty(value, "webkitRelativePath", { configurable: true, value: path });
  return value;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init) as Promise<Response>);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const created = { sessionId: "ff23ed53-08ff-4423-afa3-3c7725cc77c8", status: "uploading" };
const uploaded = { sessionId: created.sessionId, fileCount: 1, status: "uploading" };
const status = (state: string, fileCount = 1, result: unknown = null, error: string | null = null) => ({
  sessionId: created.sessionId, status: state, fileCount, workflowSessionId: null, result, error, createdAt: "", updatedAt: "",
});

describe("workspace upload interface", () => {
  it("uploads nested folder selections sequentially using basename filenames and does not start processing", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    let activeUploads = 0;
    let maximumActiveUploads = 0;
    const fetchMock = stubFetch(async (url, init) => {
      if (url.endsWith("/api/extraction/workspace")) { calls.push("create"); return response(201, created); }
      if (url.endsWith("/uploads")) {
        calls.push("upload");
        activeUploads += 1;
        maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
        const form = init?.body as FormData;
        const selected = form.get("file") as File;
        expect(selected.name).toBe("report.pdf");
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeUploads -= 1;
        return response(200, { ...uploaded, fileCount: calls.filter((value) => value === "upload").length });
      }
      if (url.endsWith("/process")) calls.push("process");
      throw new Error(`Unexpected route ${url}`);
    });
    render(<UploadWorkspace />);
    const folderPicker = screen.getByLabelText("Choose folder") as HTMLInputElement;
    expect(folderPicker.hasAttribute("webkitdirectory")).toBe(true);
    await user.upload(folderPicker, file("report.pdf", "FolderA/nested/report.pdf"));
    await user.upload(folderPicker, file("report.pdf", "FolderB/report.pdf"));
    expect(screen.getAllByText("report.pdf")).toHaveLength(2);
    expect(screen.getByText(/Selected from FolderA\/nested/)).toBeTruthy();
    expect(screen.getByText(/Selected from FolderB/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Upload files" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Upload files" }));
    await screen.findByText("All selected files uploaded");
    expect(screen.queryByRole("button", { name: "Start workflow" })).toBeNull();
    expect(calls).toEqual(["create", "upload", "upload"]);
    expect(maximumActiveUploads).toBe(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/uploads"))).toHaveLength(2);
    expect(push).toHaveBeenCalledWith(`/workspaces/${created.sessionId}`);
  });

  it("blocks empty/unsupported selections and stops after an upload network failure without retry", async () => {
    const user = userEvent.setup();
    let uploadCount = 0;
    const fetchMock = stubFetch(async (url) => {
      if (url.endsWith("/api/extraction/workspace")) return response(201, created);
      if (url.endsWith("/uploads")) {
        uploadCount += 1;
        if (uploadCount === 2) throw new TypeError("Network connection lost.");
        return response(200, uploaded);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    render(<UploadWorkspace />);
    const picker = screen.getByLabelText("Choose files") as HTMLInputElement;
    await user.upload(picker, new File([], "empty.pdf", { type: "application/pdf" }));
    expect((screen.getByRole("button", { name: "Upload files" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Remove empty.pdf" }));
    await user.upload(picker, [file("one.pdf"), file("two.pdf"), file("three.pdf")]);
    await user.click(screen.getByRole("button", { name: "Upload files" }));
    await screen.findByRole("alert");
    expect(screen.getByText(/Batch stopped at two.pdf/)).toBeTruthy();
    expect(uploadCount).toBe(2);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/process"))).toBe(false);
  });
});

describe("workspace workflow monitor", () => {
  it("starts only after explicit click and polls to completion with result outcomes", async () => {
    const user = userEvent.setup();
    let statusCalls = 0;
    const result = { extractionResults: [
      { sourceName: "ok.pdf", status: "completed", data: { fields: [] }, reason: null },
      { sourceName: "skip.pdf", status: "skipped", data: null, reason: "Reporting period did not match." },
    ], resultPaths: ["C:\\private\\result.json"], excerpt: "private document content" };
    const fetchMock = stubFetch(async (url) => {
      if (url.endsWith("/process")) return response(202, { sessionId: created.sessionId, status: "queued" });
      if (url.endsWith(created.sessionId)) {
        statusCalls += 1;
        if (statusCalls === 1) return response(200, status("uploading", 2));
        if (statusCalls === 2) return response(200, status("running", 2));
        return response(200, status("completed", 2, result));
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const view = render(<WorkspaceMonitor sessionId={created.sessionId} />);
    await screen.findByText(/Files uploaded — workflow not started/);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/process"))).toBe(false);
    await user.tab();
    expect(document.activeElement).toBe(screen.getAllByRole("button", { name: "Start workflow" })[0]);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getAllByText(/Workflow running/).length).toBeGreaterThan(0));
    await screen.findByText("Workflow finished", {}, { timeout: 5000 });
    expect(screen.getByText("Live backend status").parentElement?.textContent).toContain("Workflow completed");
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/process"))).toHaveLength(1);
    expect(screen.getByText("Completed: 1 · Skipped: 1 · Failed: 0")).toBeTruthy();
    expect(screen.getByText("skip.pdf")).toBeTruthy();
    expect(screen.getByText("Reporting period did not match.")).toBeTruthy();
    await user.click(screen.getAllByText("Inspect sanitized structured result")[0]);
    const jsonBlock = view.container.querySelector(".result-json pre")?.textContent ?? "";
    expect(jsonBlock).not.toContain("resultPaths");
    expect(jsonBlock).not.toContain("private document content");
  });

  it("shows safe workflow failures and reloads by observing status without starting another run", async () => {
    let calls = 0;
    const fetchMock = stubFetch(async (url) => {
      if (url.endsWith("/process")) return response(500, { error: "must not start on reload" });
      if (url.endsWith(created.sessionId)) {
        calls += 1;
        return calls === 1
          ? response(200, status("running", 1))
          : response(200, status("failed", 1, null, "Workflow processing failed."));
      }
      throw new Error(`Unexpected request ${url}`);
    });
    render(<WorkspaceMonitor sessionId={created.sessionId} />);
    await waitFor(() => expect(screen.getAllByText(/Workflow running/).length).toBeGreaterThan(0));
    expect(await screen.findByRole("alert", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByText("Workflow processing failed.").length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/process"))).toBe(false);
  }, 10000);

  it("reconciles a process 409 through status before allowing another explicit start", async () => {
    const user = userEvent.setup();
    let starts = 0;
    let statusCalls = 0;
    stubFetch(async (url) => {
      if (url.endsWith("/process")) { starts += 1; return response(409, { error: "Already started." }); }
      if (url.endsWith(created.sessionId)) {
        statusCalls += 1;
        return response(200, status("uploading", 1));
      }
      throw new Error(`Unexpected request ${url}`);
    });
    render(<WorkspaceMonitor sessionId={created.sessionId} />);
    await screen.findByText(/Files uploaded — workflow not started/);
    await user.click(screen.getAllByRole("button", { name: "Start workflow" })[0]);
    await screen.findByText(/may explicitly try Start workflow again/);
    expect(statusCalls).toBeGreaterThanOrEqual(2);
    expect(starts).toBe(1);
  });
});
