import { createStore } from 'solid-js/store';
import { createMemo } from 'solid-js';
import { assessmentStore } from './assessmentStore';
import { tradingStore } from './tradingStore';
import { rulesStore } from './rulesStore';

interface AppState {
  balance: number;
  startingBalance: number;
  pnl: number;
  pnlPercent: number;
  profitProgress: number;
  daysProgress: number;
  totalExposure: number;
  totalPositions: number;
  warningLevel: 'safe' | 'warning' | 'danger';
  loading: boolean;
}

const [appState, setAppState] = createStore<AppState>({
  balance: 0,
  startingBalance: 0,
  pnl: 0,
  pnlPercent: 0,
  profitProgress: 0,
  daysProgress: 0,
  totalExposure: 0,
  totalPositions: 0,
  warningLevel: 'safe',
  loading: false,
});

export const appStore = {
  state: appState,

  // Computed values
  getBalance: createMemo(() => {
    const assessment = assessmentStore.state.currentAssessment;
    return assessment?.balance || 0;
  }),

  getStartingBalance: createMemo(() => {
    const assessment = assessmentStore.state.currentAssessment;
    return assessment?.starting_balance || 0;
  }),

  getPnL: createMemo(() => {
    const balance = appStore.getBalance();
    const starting = appStore.getStartingBalance();
    return balance - starting;
  }),

  getPnLPercent: createMemo(() => {
    const pnl = appStore.getPnL();
    const starting = appStore.getStartingBalance();
    return starting > 0 ? (pnl / starting) * 100 : 0;
  }),

  getProfitProgress: createMemo(() => {
    const pnlPercent = appStore.getPnLPercent();
    return Math.min((pnlPercent / 8) * 100, 100); // 8% is phase 1 target
  }),

  getDaysProgress: createMemo(() => {
    const assessment = assessmentStore.state.currentAssessment;
    if (!assessment) return 0;
    
    const daysCompleted = assessment.trading_days_completed || 0;
    const minDaysRequired = assessment.min_trading_days || 10;
    
    return Math.min((daysCompleted / minDaysRequired) * 100, 100);
  }),

  getTotalExposure: createMemo(() => {
    return tradingStore.state.positions.reduce(
      (sum, pos) => sum + pos.size * pos.current_price,
      0
    );
  }),

  getTotalPositions: createMemo(() => {
    return tradingStore.state.positions.length;
  }),

  getWarningLevel: createMemo(() => {
    if (rulesStore.state.violations.length > 0) {
      return 'danger';
    }
    if (rulesStore.state.warnings.length > 0) {
      return 'warning';
    }
    return 'safe';
  }),

  // Sync state with computed values
  syncState() {
    setAppState({
      balance: appStore.getBalance(),
      startingBalance: appStore.getStartingBalance(),
      pnl: appStore.getPnL(),
      pnlPercent: appStore.getPnLPercent(),
      profitProgress: appStore.getProfitProgress(),
      daysProgress: appStore.getDaysProgress(),
      totalExposure: appStore.getTotalExposure(),
      totalPositions: appStore.getTotalPositions(),
      warningLevel: appStore.getWarningLevel(),
    });
  },

  setLoading(loading: boolean) {
    setAppState('loading', loading);
  },
};
