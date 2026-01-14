"use client"

import { type Component, createSignal, Show, For } from "solid-js"
import {
  workspaces,
  currentWorkspaceId,
  setCurrentWorkspaceId,
  addWorkspace,
  deleteWorkspace,
} from "../stores/workspaceStore"
import { accountBalance, buyingPower, dayPL } from "../stores/marketDataStore"

const TopBar: Component = () => {
  const [showNewWorkspace, setShowNewWorkspace] = createSignal(false)
  const [newWorkspaceName, setNewWorkspaceName] = createSignal("")

  const handleAddWorkspace = () => {
    const name = newWorkspaceName().trim()
    if (name) {
      addWorkspace(name)
      setNewWorkspaceName("")
      setShowNewWorkspace(false)
    }
  }

  return (
    <div class="h-12 bg-black border-b border-gray-800 flex items-center justify-between px-4">
      <div class="flex items-center gap-4">
        <div class="text-lg font-semibold">Vatic Prop</div>

        <div class="flex items-center gap-2">
          <For each={workspaces()}>
            {(workspace) => (
              <div class="flex items-center gap-1">
                <button
                  class={`px-3 py-1 text-sm rounded transition-colors ${
                    currentWorkspaceId() === workspace.id
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:text-white hover:bg-gray-900"
                  }`}
                  onClick={() => setCurrentWorkspaceId(workspace.id)}
                >
                  {workspace.name}
                </button>
                {workspaces().length > 1 && (
                  <button
                    class="text-gray-500 hover:text-red-400 text-xs px-1"
                    onClick={() => deleteWorkspace(workspace.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </For>

          <button class="px-2 py-1 text-sm text-gray-400 hover:text-white" onClick={() => setShowNewWorkspace(true)}>
            +
          </button>
        </div>
      </div>

      <div class="flex items-center gap-6 font-mono text-sm">
        <div class="flex flex-col items-end">
          <div class="text-xs text-gray-500">Balance</div>
          <div class="text-white">${accountBalance().toLocaleString()}</div>
        </div>
        <div class="flex flex-col items-end">
          <div class="text-xs text-gray-500">Buying Power</div>
          <div class="text-white">${buyingPower().toLocaleString()}</div>
        </div>
        <div class="flex flex-col items-end">
          <div class="text-xs text-gray-500">Day P/L</div>
          <div class={dayPL() >= 0 ? "text-green-500" : "text-red-500"}>
            {dayPL() >= 0 ? "+" : ""}${dayPL().toFixed(2)}
          </div>
        </div>
      </div>

      {/* New workspace modal */}
      <Show when={showNewWorkspace()}>
        <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 w-96">
            <h3 class="text-lg font-semibold mb-4">New Workspace</h3>
            <input
              type="text"
              class="w-full bg-black border border-gray-700 rounded px-3 py-2 text-white mb-4"
              placeholder="Workspace name"
              value={newWorkspaceName()}
              onInput={(e) => setNewWorkspaceName(e.currentTarget.value)}
              onKeyPress={(e) => e.key === "Enter" && handleAddWorkspace()}
            />
            <div class="flex gap-2 justify-end">
              <button
                class="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
                onClick={() => {
                  setShowNewWorkspace(false)
                  setNewWorkspaceName("")
                }}
              >
                Cancel
              </button>
              <button
                class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                onClick={handleAddWorkspace}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default TopBar
