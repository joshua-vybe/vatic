import { createStore } from 'solid-js/store';
import { createMemo } from 'solid-js';
import { RuleStatus, Violation, Warning } from '../types';

interface RulesState {
  ruleStatus: RuleStatus | null;
  violations: Violation[];
  warnings: Warning[];
  loading: boolean;
  error: string | null;
}

const [rulesState, setRulesState] = createStore<RulesState>({
  ruleStatus: null,
  violations: [],
  warnings: [],
  loading: false,
  error: null,
});

export const rulesStore = {
  state: rulesState,

  updateRuleStatus(status: RuleStatus) {
    setRulesState('ruleStatus', status);
  },

  addViolation(violation: Violation) {
    setRulesState('violations', violations => [...violations, violation]);
  },

  clearViolations() {
    setRulesState('violations', []);
  },

  addWarning(warning: Warning) {
    setRulesState('warnings', warnings => [...warnings, warning]);
  },

  clearWarnings() {
    setRulesState('warnings', []);
  },

  getWarningLevel: createMemo(() => {
    if (rulesState.violations.length > 0) {
      return 'danger';
    }
    if (rulesState.warnings.length > 0) {
      return 'warning';
    }
    return 'safe';
  }),
};
