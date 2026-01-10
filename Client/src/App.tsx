// src/App.tsx
// ✅ FORCE GIT CHANGE: RequireAdminRoute validates token with backend (2026-01-10)

import React, { useEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
} from "react-router-dom";
import "./App.css";

import HomePage from "./pages/HomePage";
import AdminPage from "./pages/AdminPage";
import CandidatePage from "./pages/CandidatePage";
import ResultsPage from "./pages/ResultsPage";
import ResultsListPage from "./pages/ResultsListPage";
import ResultsGroupPage from "./pages/ResultsGroupPage";

import amintLogo from "./assets/amint-logo.png";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:3001";
const ADMIN_TOKEN_KEY = "flavaai-admin-token";

const RequireAdminRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const [state, setState] = useState<"checking" | "ok" | "no">("checking");

  useEffect(() => {
    const run = async () => {
      const token = String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
      if (!token) {
        setState("no");
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/admin/ping`, {
          headers: { "x-admin-token": token },
        });

        if (!res.ok) {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          setState("no");
          return;
        }

        setState("ok");
      } catch {
        // Si backend no responde, por seguridad NO damos acceso.
        setState("no");
      }
    };

    run();
  }, []);

  if (state === "checking") return null;
  if (state === "no") return <Navigate to="/" replace />;
  return children;
};

const TopNav: React.FC = () => {
  const location = useLocation();
  const isCandidateRoute = location.pathname.startsWith("/candidate/");

  return (
    <nav className="TopNav">
      {/* ✅ El logo siempre va a HOME (no a admin) */}
      <NavLink className="TopNavLogo" to="/" aria-label="Ir a Home">
        <img
          src={amintLogo}
          alt="AMINT"
          onError={(e) => console.error("❌ No se pudo cargar el logo", e)}
        />
      </NavLink>

      {!isCandidateRoute && (
        <>
          <div className="TopNavLinks">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}
            >
              Home
            </NavLink>

            {/* ❌ Quitamos link a Admin del menú */}
            {/* <NavLink to="/admin" className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}>
              Admin
            </NavLink> */}

            <NavLink
              to="/results"
              className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}
            >
              Results
            </NavLink>
          </div>

          <div className="TopNavTagline">
            <div className="TopNavTaglineTitle">AMINT Interview Hub</div>
            <div className="TopNavTaglineSub">Insight-driven interviews, powered by AI</div>
          </div>
        </>
      )}
    </nav>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <TopNav />

      <main className="AppShell">
        <Routes>
          <Route path="/" element={<HomePage />} />

          {/* ✅ Ruta admin protegida + validada en backend */}
          <Route
            path="/admin"
            element={
              <RequireAdminRoute>
                <AdminPage />
              </RequireAdminRoute>
            }
          />

          <Route path="/candidate/:token" element={<CandidatePage />} />

          {/* ✅ LISTADO */}
          <Route path="/results" element={<ResultsListPage />} />

          {/* ✅ DETALLE DE GRUPO */}
          <Route path="/results/group/:groupId" element={<ResultsGroupPage />} />

          {/* ✅ compatibilidad */}
          <Route path="/results/demo" element={<Navigate to="/results" replace />} />

          {/* ✅ DETALLE POR TOKEN */}
          <Route path="/results/:token" element={<ResultsPage />} />
        </Routes>
      </main>
    </Router>
  );
};

export default App;
