import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import ReviewPage from "./pages/ReviewPage";
import BlueprintViewerPage from "./pages/BlueprintViewerPage";
import NotFound from "./pages/NotFound";
import AppShell from "./components/layout/AppShell";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import SegmentDetail from "./pages/SegmentDetail";
import StandardsPage from "./pages/StandardsPage";

const queryClient = new QueryClient();

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  return user ? <>{children}</> : <Navigate to="/auth" replace />;
};

const AuthRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  return user ? <Navigate to="/app" replace /> : <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/auth" element={<AuthRoute><AuthPage /></AuthRoute>} />

                {/* App Shell with sidebar — all protected routes */}
                <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                  <Route index element={<Dashboard />} />
                  <Route path="project/:id" element={<ProjectWorkspace />} />
                  <Route path="project/:id/files" element={<ProjectWorkspace />} />
                  <Route path="project/:id/segments" element={<ProjectWorkspace />} />
                  <Route path="project/:id/segments/:segId" element={<SegmentDetail />} />
                  <Route path="project/:id/qa" element={<ProjectWorkspace />} />
                  <Route path="project/:id/outputs" element={<ProjectWorkspace />} />
                  <Route path="project/:id/settings" element={<ProjectWorkspace />} />
                  <Route path="standards" element={<StandardsPage />} />
                </Route>

                <Route path="/blueprint-viewer" element={<ProtectedRoute><BlueprintViewerPage /></ProtectedRoute>} />
                <Route path="/review/:token" element={<ReviewPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
