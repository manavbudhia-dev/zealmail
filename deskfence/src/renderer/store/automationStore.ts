import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AutomationRule } from '../../shared/types';
import { RuleEngine } from '../utils/rule-engine';

interface AutomationStore {
  rules: AutomationRule[];

  // Actions
  addRule: (rule: AutomationRule) => void;
  updateRule: (ruleId: string, updates: Partial<AutomationRule>) => void;
  deleteRule: (ruleId: string) => void;
  toggleRule: (ruleId: string) => void;
  setRules: (rules: AutomationRule[]) => void;

  // Rule execution
  testRule: (rule: AutomationRule, filePath: string, fileName: string, fileSize: number, fileModified?: number) => boolean;
  findMatchingRules: (filePath: string, fileName: string, fileSize: number, fileModified?: number) => AutomationRule[];
}

export const useAutomationStore = create<AutomationStore>()(
  persist(
    (set, get) => ({
  rules: [],

  addRule: (rule) => set((state) => ({
    rules: [...state.rules, rule],
  })),

  updateRule: (ruleId, updates) => set((state) => ({
    rules: state.rules.map((r) =>
      r.id === ruleId ? { ...r, ...updates } : r
    ),
  })),

  deleteRule: (ruleId) => set((state) => ({
    rules: state.rules.filter((r) => r.id !== ruleId),
  })),

  toggleRule: (ruleId) => set((state) => ({
    rules: state.rules.map((r) =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    ),
  })),

  setRules: (rules) => set({ rules }),

  testRule: (rule, filePath, fileName, fileSize, fileModified) => {
    return RuleEngine.matchesRule(filePath, fileName, fileSize, rule, fileModified);
  },

  findMatchingRules: (filePath, fileName, fileSize, fileModified) => {
    return get().rules.filter((rule) =>
      RuleEngine.matchesRule(filePath, fileName, fileSize, rule, fileModified)
    );
  },
}),
    { name: 'deskfence-rules', partialize: (state) => ({ rules: state.rules }) }
  )
);
