import { Position, RuleStatus, Violation } from '../types';

export interface MarketPriceMessage {
  type: 'market_price';
  market: string;
  price: number;
  timestamp: number;
}

export interface PnLUpdateMessage {
  type: 'pnl_update';
  assessment_id: string;
  balance: number;
  peak_balance: number;
  pnl: number;
  positions: Position[];
}

export interface RuleStatusMessage {
  type: 'rule_status';
  assessment_id: string;
  rules: RuleStatus;
}

export interface ViolationMessage {
  type: 'violation';
  assessment_id: string;
  violation: Violation;
}

export type WebSocketMessage = 
  | MarketPriceMessage 
  | PnLUpdateMessage 
  | RuleStatusMessage 
  | ViolationMessage;
