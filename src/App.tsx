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
import OrdersPage from "./pages/OrdersPage";
import OrderDetail from "./pages/OrderDetail";

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
                  <Route path="project/:id/segments/:segId" element={<SegmentDetail />} />
                  {/* Legacy archive — kept reachable but not the primary path */}
                  <Route path="legacy/project/:id" element={<LegacyProjectWorkspace />} />
                  <Route path="legacy/project/:id/files" element={<LegacyProjectWorkspace />} />
                  <Route path="legacy/project/:id/segments" element={<LegacyProjectWorkspace />} />
                  <Route path="legacy/project/:id/qa" element={<LegacyProjectWorkspace />} />
                  <Route path="legacy/project/:id/estimate" element={<LegacyProjectWorkspace />} />
                  <Route path="legacy/project/:id/shop-drawings" element={<LegacyProjectWorkspace />} />
                  <Route path="legacy/project/:id/outputs" element={<LegacyProjectWorkspace />} />
                  <Route path="legacy/project/:id/settings" element={<LegacyProjectWorkspace />} />
                  <Route path="standards" element={<StandardsPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="orders/:orderId" element={<OrderDetail />} />
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
