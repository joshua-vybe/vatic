import { createStore } from 'solid-js/store';
import { createEffect } from 'solid-js';
import { User } from '../types';
import * as authApi from '../lib/api/auth';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const [authState, setAuthState] = createStore<AuthState>({
  user: null,
  token: localStorage.getItem('auth_token'),
  isAuthenticated: !!localStorage.getItem('auth_token'),
  loading: false,
  error: null,
});

export const authStore = {
  state: authState,
  
  async login(email: string, password: string) {
    setAuthState('loading', true);
    setAuthState('error', null);
    
    try {
      const response = await authApi.login(email, password);
      setAuthState({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        loading: false,
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      setAuthState({
        error: message,
        loading: false,
      });
      throw error;
    }
  },

  async register(email: string, password: string) {
    setAuthState('loading', true);
    setAuthState('error', null);
    
    try {
      const response = await authApi.register(email, password);
      setAuthState({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        loading: false,
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      setAuthState({
        error: message,
        loading: false,
      });
      throw error;
    }
  },

  async loadUser() {
    if (!authState.token) {
      return;
    }

    setAuthState('loading', true);
    
    try {
      const user = await authApi.getMe();
      setAuthState({
        user,
        loading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load user';
      setAuthState({
        error: message,
        loading: false,
      });
    }
  },

  logout() {
    authApi.logout();
    setAuthState({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
    });
  },

  setToken(token: string) {
    localStorage.setItem('auth_token', token);
    setAuthState({
      token,
      isAuthenticated: true,
    });
  },
};

// Load user on initialization if token exists
createEffect(() => {
  if (authState.token && !authState.user) {
    authStore.loadUser();
  }
});
