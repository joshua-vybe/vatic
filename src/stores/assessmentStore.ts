import { createStore } from 'solid-js/store';
import { Assessment } from '../types';
import * as assessmentApi from '../lib/api/assessment';

interface AssessmentState {
  assessments: Assessment[];
  currentAssessment: Assessment | null;
  loading: boolean;
  error: string | null;
}

const [assessmentState, setAssessmentState] = createStore<AssessmentState>({
  assessments: [],
  currentAssessment: null,
  loading: false,
  error: null,
});

export const assessmentStore = {
  state: assessmentState,

  async fetchAssessments() {
    setAssessmentState('loading', true);
    setAssessmentState('error', null);
    
    try {
      const assessments = await assessmentApi.getAssessments();
      setAssessmentState('assessments', assessments);
      setAssessmentState('loading', false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch assessments';
      setAssessmentState({
        error: message,
        loading: false,
      });
    }
  },

  async selectAssessment(id: string) {
    setAssessmentState('loading', true);
    setAssessmentState('error', null);
    
    try {
      const assessment = await assessmentApi.getAssessment(id);
      setAssessmentState('currentAssessment', assessment);
      setAssessmentState('loading', false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch assessment';
      setAssessmentState({
        error: message,
        loading: false,
      });
    }
  },

  async startAssessment(id: string) {
    setAssessmentState('loading', true);
    
    try {
      const assessment = await assessmentApi.startAssessment(id);
      setAssessmentState('currentAssessment', assessment);
      setAssessmentState('loading', false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start assessment';
      setAssessmentState({
        error: message,
        loading: false,
      });
      throw error;
    }
  },

  async pauseAssessment(id: string) {
    setAssessmentState('loading', true);
    
    try {
      const assessment = await assessmentApi.pauseAssessment(id);
      setAssessmentState('currentAssessment', assessment);
      setAssessmentState('loading', false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pause assessment';
      setAssessmentState({
        error: message,
        loading: false,
      });
      throw error;
    }
  },

  async abandonAssessment(id: string) {
    setAssessmentState('loading', true);
    
    try {
      const assessment = await assessmentApi.abandonAssessment(id);
      setAssessmentState('currentAssessment', assessment);
      setAssessmentState('loading', false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to abandon assessment';
      setAssessmentState({
        error: message,
        loading: false,
      });
      throw error;
    }
  },

  updateFromWebSocket(assessment: Assessment) {
    setAssessmentState('currentAssessment', assessment);
  },
};
