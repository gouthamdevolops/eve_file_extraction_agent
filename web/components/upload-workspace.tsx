"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { workspaceApi } from "@/lib/workspace-api";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 250 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  ".pdf", ".docx", ".xlsx", ".doc", ".xls", ".pptx", ".odt", ".ods", ".odp",
  ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp",
]);

type SelectedFile = { id: number; file: File; label: string; errors: string[] };
type UploadState = "idle" | "uploading" | "uploaded" | "failed";

function basename(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop() || name;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileType(name: string): string {
  const extension = basename(name).match(/\.[^.]+$/)?.[0].toLowerCase() ?? "";
  if (extension === ".pdf") return "PDF document";
  if ([".xlsx", ".xls", ".ods"].includes(extension)) return "Spreadsheet";
  if ([".docx", ".doc", ".odt"].includes(extension)) return "Word document";
  if ([".pptx", ".odp"].includes(extension)) return "Presentation";
  if ([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"].includes(extension)) return "Image";
  return extension ? `${extension.slice(1).toUpperCase()} file` : "File";
}

function fileErrors(file: File): string[] {
  const errors: string[] = [];
  const extension = basename(file.name).match(/\.[^.]+$/)?.[0].toLowerCase() ?? "";
  if (!SUPPORTED_EXTENSIONS.has(extension)) errors.push("Unsupported file type.");
  if (file.size === 0) errors.push("File is empty.");
  if (file.size > MAX_FILE_BYTES) errors.push("File exceeds the 25 MiB per-file limit.");
  return errors;
}

export default function UploadWorkspace() {
  const router = useRouter();
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedFile, setFailedFile] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0);
  const invalidCount = files.filter((item) => item.errors.length > 0).length;
  const validSelection = files.length > 0 && invalidCount === 0 && files.length <= MAX_FILES && totalBytes <= MAX_WORKSPACE_BYTES;
  const busy = uploadState === "uploading";
  const selectionLocked = busy || uploadState === "uploaded" || uploadState === "failed";

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const additions = Array.from(list).map((file) => ({
      id: nextId.current++,
      file,
      label: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      errors: fileErrors(file),
    }));
    setFiles((current) => [...current, ...additions]);
    setUploadState("idle");
    setConfirmedCount(0);
    setError(null);
    setFailedFile(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!selectionLocked) addFiles(event.dataTransfer.files);
  }

  function removeFile(id: number) {
    setFiles((current) => current.filter((item) => item.id !== id));
  }

  function newBatch() {
    setFiles([]);
    setUploadState("idle");
    setConfirmedCount(0);
    setWorkspaceId(null);
    setError(null);
    setFailedFile(null);
    router.push("/");
    if (filesInput.current) filesInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
  }

  async function uploadSelection() {
    if (!validSelection || busy) return;
    setUploadState("uploading");
    setError(null);
    setFailedFile(null);
    setConfirmedCount(0);
    try {
      const workspace = await workspaceApi.create();
      setWorkspaceId(workspace.sessionId);
      let confirmed = 0;
      for (const item of files) {
        try {
          await workspaceApi.upload(workspace.sessionId, item.file);
          confirmed += 1;
          setConfirmedCount(confirmed);
        } catch (cause) {
          setFailedFile(basename(item.file.name));
          throw cause;
        }
      }
      setUploadState("uploaded");
      router.push(`/workspaces/${workspace.sessionId}`);
    } catch (cause) {
      setUploadState("failed");
      setError(cause instanceof Error ? cause.message : "Upload failed. Start a new batch to try again.");
    }
  }

  return (
    <section className="selection-panel" aria-labelledby="selection-title">
      <div className="selection-heading">
        <div>
          <p className="section-kicker">DOCUMENT BATCH</p>
          <h2 id="selection-title">Select and review documents</h2>
          <p className="selection-subtitle">Choose files or a folder, then review the batch before it is uploaded.</p>
        </div>
        <span className="preview-tag">Sequential upload</span>
      </div>

      <div
        className={`selection-actions ${dragging ? "is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); if (!selectionLocked) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (!nextTarget || !event.currentTarget.contains(nextTarget)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <div className="dropzone">
          <span className="dropzone-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M16 21V5m0 0-6 6m6-6 6 6M6 19v7h20v-7" /></svg>
          </span>
          <strong>Drop documents here</strong>
          <span className="dropzone-copy">or choose files or a folder from your device</span>
          <div className="picker-actions">
            <label className="mock-outline-button">
              Choose files
              <input ref={filesInput} type="file" multiple accept={[...SUPPORTED_EXTENSIONS].join(",")} disabled={selectionLocked} onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
            </label>
            <label className="mock-outline-button">
              Choose folder
              <input ref={(node) => { folderInput.current = node; node?.setAttribute("webkitdirectory", ""); node?.setAttribute("directory", ""); }} type="file" multiple disabled={selectionLocked} onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
            </label>
          </div>
          <small>Multiple folders can be added by choosing each folder in turn.</small>
        </div>
        <aside className="limits-card" aria-label="Upload limits">
          <span className="limits-icon" aria-hidden="true">⌁</span>
          <strong>Batch limits</strong>
          <ul><li>Up to <b>20 files</b></li><li><b>25 MiB</b> maximum per file</li><li><b>250 MiB</b> total workspace size</li></ul>
        </aside>
      </div>

      <div className="selection-summary" aria-live="polite" aria-label="Selection summary">
        <div className="summary-tile"><span>Selected files</span><strong>{files.length}</strong><small>of 20 maximum</small></div>
        <div className="summary-tile"><span>Total size</span><strong>{formatBytes(totalBytes)}</strong><small>of 250 MiB maximum</small></div>
        <div className="summary-tile upload-summary"><span>Upload confirmed</span><strong><span key={confirmedCount} className="confirmed-count">{confirmedCount}</span> <small>of {files.length} files</small></strong><small>{busy ? "Uploading sequentially" : "Confirmed by the service"}</small></div>
      </div>

      {(files.length > MAX_FILES || totalBytes > MAX_WORKSPACE_BYTES) && (
        <p className="validation-alert" role="alert">
          {files.length > MAX_FILES && "Selection exceeds the 20-file limit. "}
          {totalBytes > MAX_WORKSPACE_BYTES && "Selection exceeds the 250 MiB workspace limit."}
        </p>
      )}

      {busy && <div className="state-banner banner-connecting" role="status" aria-live="polite"><span className="banner-icon" aria-hidden="true">↗</span><span><strong>Uploading sequentially</strong><small>{confirmedCount} of {files.length} files uploaded.</small></span></div>}
      {uploadState === "uploaded" && <div className="state-banner banner-complete" role="status"><span className="banner-icon" aria-hidden="true">✓</span><span><strong>All selected files uploaded</strong><small>{confirmedCount} of {files.length} files confirmed. Processing has not started.</small></span></div>}
      {uploadState === "failed" && <div className="state-banner banner-stopped" role="alert"><span className="banner-icon" aria-hidden="true">!</span><span><strong>Batch stopped{failedFile ? ` at ${failedFile}` : ""}</strong><small>{error} No automatic retry was made. Start a new batch; earlier confirmed files may remain saved.</small></span></div>}

      {files.length > 0 && (
        <>
          <div className="review-heading"><div><h3>Files in this batch</h3><p>Review filenames, file types, and sizes before upload.</p></div><span className="file-count-pill">{files.length} files · {formatBytes(totalBytes)}</span></div>
          <ul className="mock-file-list">
            {files.map((item, index) => {
              const fileStatus = uploadState === "failed" && basename(item.file.name) === failedFile ? "Stopped" : index < confirmedCount ? "Confirmed" : busy && index === confirmedCount ? "Uploading" : "Ready";
              const selectedPath = item.label.replace(/\\/g, "/");
              const parentLabel = selectedPath.includes("/") ? selectedPath.slice(0, selectedPath.lastIndexOf("/")) : "";
              return (
                <li className={`mock-file-row ${fileStatus === "Confirmed" ? "file-confirmed" : fileStatus === "Stopped" ? "file-stopped" : ""}`} key={item.id} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
                  <span className="file-type-icon" aria-hidden="true">{fileType(item.file.name).slice(0, 3).toUpperCase()}</span>
                  <span className="mock-file-main">
                    <strong>{basename(item.file.name)}</strong>
                    <small>{fileType(item.file.name)} <span aria-hidden="true">·</span> {formatBytes(item.file.size)}{parentLabel && <span className="folder-origin">Selected from {parentLabel}</span>}</small>
                    {item.errors.map((message) => <span className="validation-message" key={message}>{message}</span>)}
                  </span>
                  <span className={`file-state ${fileStatus === "Stopped" ? "file-state-error" : fileStatus === "Confirmed" ? "file-state-done" : ""}`}>{fileStatus}</span>
                  <button className="remove-visual" type="button" disabled={selectionLocked} aria-label={`Remove ${basename(item.file.name)}`} onClick={() => removeFile(item.id)}>×</button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="flattening-note">
        <span className="flattening-mark" aria-hidden="true">↳</span>
        <p><strong>Folder contents are flattened.</strong> Only each file’s basename is retained on the server; the original folder structure is not. Duplicate basenames are given a suffix to prevent overwriting.</p>
      </div>

      <div className="upload-footer">
        <span className="upload-caption">Uploads are sent one file at a time. Processing starts separately.</span>
        <div className="footer-actions">
          {uploadState === "failed" && <button className="text-button" type="button" onClick={newBatch}>New batch</button>}
          {files.length > 0 && uploadState !== "failed" && <button className="upload-button" type="button" onClick={uploadSelection} disabled={!validSelection || busy || uploadState === "uploaded"}>{busy ? "Uploading…" : "Upload files"}</button>}
          <button className="start-processing-button" type="button" disabled={uploadState !== "uploaded" || !workspaceId} onClick={() => workspaceId && router.push(`/workspaces/${workspaceId}`)} aria-label="Continue to start processing" title="Continue to the workspace to explicitly start processing">Start processing</button>
        </div>
      </div>
      {uploadState !== "uploaded" && <p className="start-gate-note">Start processing is available after every selected file is confirmed uploaded.</p>}
    </section>
  );
}
