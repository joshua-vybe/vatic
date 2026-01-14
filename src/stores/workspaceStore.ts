import { createSignal } from "solid-js"
import type { Workspace, WorkspaceLayout } from "../types/workspace"

const defaultLayout: WorkspaceLayout = {
  showChart: true,
  showOrderBook: true,
  showTimeAndSales: true,
  showOrderEntry: true,
  chartHeight: 60,
  rightPanelWidth: 320,
}

const initialWorkspaces: Workspace[] = [
  { id: "1", name: "Trading", layout: { ...defaultLayout } },
  { id: "2", name: "Analysis", layout: { ...defaultLayout, showOrderEntry: false } },
]

export const [workspaces, setWorkspaces] = createSignal<Workspace[]>(initialWorkspaces)
export const [currentWorkspaceId, setCurrentWorkspaceId] = createSignal("1")

export const getCurrentWorkspace = () => {
  return workspaces().find((w) => w.id === currentWorkspaceId())
}

export const addWorkspace = (name: string) => {
  const newWorkspace: Workspace = {
    id: Date.now().toString(),
    name,
    layout: { ...defaultLayout },
  }
  setWorkspaces([...workspaces(), newWorkspace])
  setCurrentWorkspaceId(newWorkspace.id)
}

export const deleteWorkspace = (id: string) => {
  if (workspaces().length <= 1) return
  setWorkspaces(workspaces().filter((w) => w.id !== id))
  if (currentWorkspaceId() === id) {
    setCurrentWorkspaceId(workspaces()[0].id)
  }
}

export const updateWorkspaceLayout = (layout: Partial<WorkspaceLayout>) => {
  setWorkspaces(
    workspaces().map((w) => (w.id === currentWorkspaceId() ? { ...w, layout: { ...w.layout, ...layout } } : w)),
  )
}
