"use client";

export interface AuthUser {
  email: string;
  role: string;
}

const ADMIN_USER: AuthUser = {
  id: "user-admin-001",
  name: "Admin",
  email: "admin@local",
  role: "admin",
};

export function useAuth() {
  return {
    token: "" as string,
    user: ADMIN_USER,
    isLoggedIn: true,
    threadId: `thread_${Date.now()}`,
    isAuthLoading: false,
    login: async (_email: string, _password: string): Promise<null> => null,
    logout: () => {},
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useRequireAuth() {
  return {
    token: "" as string,
    user: ADMIN_USER,
    isLoggedIn: true,
  };
}
