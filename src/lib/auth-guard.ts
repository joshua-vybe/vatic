import { Component, Show, createEffect } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { authStore } from '../stores/authStore';
import { LoadingSpinner } from '../components/LoadingSpinner';

interface ProtectedRouteProps {
  children: any;
}

export const ProtectedRoute: Component<ProtectedRouteProps> = (props) => {
  const navigate = useNavigate();

  // Redirect to login if not authenticated
  createEffect(() => {
    if (!authStore.state.isAuthenticated) {
      navigate('/login');
    }
  });

  // Load user on mount if token exists but user not loaded
  createEffect(() => {
    if (authStore.state.token && !authStore.state.user) {
      authStore.loadUser();
    }
  });

  return (
    <Show
      when={authStore.state.isAuthenticated && authStore.state.user}
      fallback={
        <div class="flex items-center justify-center min-h-screen">
          <LoadingSpinner />
        </div>
      }
    >
      {props.children}
    </Show>
  );
};

export function checkAuth(): boolean {
  const token = localStorage.getItem('auth_token');
  return !!token;
}

export function redirectToLoginIfNotAuth(): void {
  if (!checkAuth()) {
    window.location.href = '/login';
  }
}
