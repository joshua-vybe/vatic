export interface WorkspaceLayout {
  showChart: boolean
  showOrderBook: boolean
  showTimeAndSales: boolean
  showOrderEntry: boolean
  chartHeight: number
  rightPanelWidth: number
}

export interface Workspace {
  id: string
  name: string
  layout: WorkspaceLayout
}
