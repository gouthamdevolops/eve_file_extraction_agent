import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workspaceApi, type WorkspaceListResponse } from "@/lib/workspace-api";
import WorkspaceHistory from "@/components/workspace-history";
import DashboardShell from "@/components/dashboard-shell";
import WorkspacePage from "@/app/workspaces/[sessionId]/page";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
      React.createElement("a", { ...props, href }, children),
  };
});

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => window.location.pathname,
    useRouter: () => ({
      push: (href: string) => {
        window.history.pushState({}, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
    }),
    useSearchParams: () => {
      const [search, setSearch] = React.useState(window.location.search);
      React.useEffect(() => {
        const update = () => setSearch(window.location.search);
        window.addEventListener("popstate", update);
        return () => window.removeEventListener("popstate", update);
      }, []);
      return React.useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});

vi.mock("@/components/upload-workspace", () => ({ default: () => null }));
vi.mock("@/components/theme-selector", () => ({ default: () => null }));
vi.mock("@/components/workspace-monitor", () => ({ default: () => null }));

const historyFixture = JSON.parse(readFileSync(resolve(process.cwd(), "../test/fixtures/workspace-history.json"), "utf8")) as {
  records: Array<{ label: string; summary: WorkspaceListResponse["workspaces"][number] }>;
  responses: Record<string, WorkspaceListResponse>;
};
const idA = historyFixture.records[0].summary.sessionId;
const idB = historyFixture.records[1].summary.sessionId;
const idC = historyFixture.records[2].summary.sessionId;
const idD = historyFixture.records[3].summary.sessionId;

function responseFor(filters: { year?: number; month?: number } = {}): WorkspaceListResponse {
  if (filters.year === 2026 && filters.month === 8) return historyFixture.responses.august2026;
  if (filters.year === 2026) return historyFixture.responses.year2026;
  if (filters.month === 8) return historyFixture.responses.month8;
  return historyFixture.responses.unfiltered;
}

function setBrowserUrl(url: string) {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/workspaces");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace history page", () => {
  it("loads persisted history in a fresh session with all filters selected by default", async () => {
    const list = vi.spyOn(workspaceApi, "list").mockImplementation(async (filters = {}) => responseFor(filters));
    render(<WorkspaceHistory />);

    expect(screen.getByRole("status").textContent).toContain("Loading workspaces");
    await screen.findAllByRole("row");
    expect(list).toHaveBeenCalledWith({}, expect.any(AbortSignal));
    expect(sessionStorage.getItem("eve:recent-workspace")).toBeNull();
    expect((screen.getByRole("combobox", { name: "Year" }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Month" }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Clear filters" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findAllByRole("row")).toHaveLength(7);
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Saved workspace results" }).getAttribute("tabindex")).toBe("0");
  });

  it("filters year and month independently, keeps them in the URL, and links rows to existing workspaces", async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(workspaceApi, "list").mockImplementation(async (filters = {}) => responseFor(filters));
    const create = vi.spyOn(workspaceApi, "create");
    const upload = vi.spyOn(workspaceApi, "upload");
    const start = vi.spyOn(workspaceApi, "start");
    render(<WorkspaceHistory />);
    await screen.findAllByRole("row");

    await user.selectOptions(screen.getByRole("combobox", { name: "Year" }), "2026");
    await waitFor(() => expect(window.location.search).toBe("?year=2026"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    expect(list).toHaveBeenLastCalledWith({ year: 2026 }, expect.any(AbortSignal));

    await user.selectOptions(screen.getByRole("combobox", { name: "Month" }), "8");
    await waitFor(() => expect(window.location.search).toBe("?year=2026&month=8"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    expect(list).toHaveBeenLastCalledWith({ year: 2026, month: 8 }, expect.any(AbortSignal));
    expect(screen.getByRole("row", { name: new RegExp(idA) })).toBeTruthy();
    expect(screen.getByRole("row", { name: new RegExp(idB) })).toBeTruthy();
    expect(screen.queryByRole("row", { name: new RegExp(idD) })).toBeNull();
    expect(screen.getByRole("link", { name: `Open workspace ${idA}` }).getAttribute("href")).toBe(`/workspaces/${idA}`);
    expect(screen.getByText("Full workspace ID: " + idA)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();

    setBrowserUrl("/workspaces?year=2026");
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Month" }) as HTMLSelectElement).value).toBe(""));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    setBrowserUrl("/workspaces?year=2026&month=8");
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Month" }) as HTMLSelectElement).value).toBe("8"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
  });

  it("clears both filters and restores other years and unknown reporting periods", async () => {
    const user = userEvent.setup();
    vi.spyOn(workspaceApi, "list").mockImplementation(async (filters = {}) => responseFor(filters));
    render(<WorkspaceHistory />);
    await screen.findAllByRole("row");
    await user.selectOptions(screen.getByRole("combobox", { name: "Month" }), "8");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    expect(screen.getByRole("row", { name: new RegExp(idD) })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/workspaces"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(7));
    expect(screen.getAllByRole("row").some((row) => row.textContent?.includes("Not available"))).toBe(true);
  });

  it("ignores a slower obsolete response and does not show stale rows after a request error", async () => {
    const user = userEvent.setup();
    let resolveOld: ((value: WorkspaceListResponse) => void) | undefined;
    const list = vi.spyOn(workspaceApi, "list").mockImplementation((filters = {}) => {
      if (filters.year === 2026 && filters.month === undefined) return new Promise((resolve) => { resolveOld = resolve; });
      if (filters.year === 2026 && filters.month === 8) return Promise.resolve(historyFixture.responses.august2026);
      return Promise.resolve(historyFixture.responses.unfiltered);
    });
    render(<WorkspaceHistory />);
    await screen.findAllByRole("row");
    await user.selectOptions(screen.getByRole("combobox", { name: "Year" }), "2026");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Loading workspaces"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Month" }), "8");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    expect(list.mock.calls[1][1]?.aborted).toBe(true);

    resolveOld?.(historyFixture.responses.year2026);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    expect(screen.queryByRole("row", { name: new RegExp(idC) })).toBeNull();

    list.mockImplementation(async (filters = {}) => {
      if (filters.month === 9) throw new Error("backend unavailable");
      return responseFor(filters);
    });
    await user.selectOptions(screen.getByRole("combobox", { name: "Month" }), "9");
    expect((await screen.findByRole("alert")).textContent).toBe("Could not load workspaces. Reload the page to try again.");
    expect(screen.queryByRole("row")).toBeNull();
  });

  it("provides history links from the home and workspace detail pages", async () => {
    const home = render(<DashboardShell />);
    expect(screen.getByRole("link", { name: "Workspace history" }).getAttribute("href")).toBe("/workspaces");
    home.unmount();

    const detail = await WorkspacePage({ params: Promise.resolve({ sessionId: idA }) });
    render(detail);
    expect(screen.getByRole("link", { name: "Workspace history" }).getAttribute("href")).toBe("/workspaces");
  });
});
