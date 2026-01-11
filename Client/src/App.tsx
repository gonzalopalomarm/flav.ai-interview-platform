// src/App.tsx
import React from "react";
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

const ADMIN_TOKEN_KEY = "flavaai-admin-token";

// ✅ robusto: evita tokens basura tipo "undefined"
function hasAdminToken() {
  const t = String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
  if (!t) return false;
  if (t === "undefined" || t === "null" || t === "false") return false;
  if (t.length < 10) return false;
  return true;
}

// ✅ Pantalla “no pública” (no hay rutas públicas extra, solo se renderiza en rutas internas)
const RestrictedPage: React.FC = () => {
  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header" style={{ alignItems: "flex-start" }}>
        <h1 style={{ marginTop: 10 }}>Acceso restringido</h1>
        <p style={{ opacity: 0.85, maxWidth: 720 }}>
          Esta plataforma solo es pública para candidatos mediante un enlace directo de entrevista{" "}
          (<strong>/candidate/&lt;token&gt;</strong>).
          <br />
          Si eres parte del equipo interno, introduce el token en el panel de Admin desde un dispositivo autorizado.
        </p>
      </header>
    </div>
  );
};

// ✅ En vez de redirigir a una ruta pública, renderiza RestrictedPage
const RequireAdminRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  if (!hasAdminToken()) return <RestrictedPage />;
  return children;
};

const TopNav: React.FC = () => {
  const location = useLocation();

  const isCandidateInterviewRoute = location.pathname.startsWith("/candidate/");
  const isAuthed = hasAdminToken();

  // ✅ Si es candidato o no authed -> ocultar navegación interna
  const hideInternalNav = isCandidateInterviewRoute || !isAuthed;

  return (
    <nav className="TopNav">
      {/* Si no authed, el logo NO debe llevar a una zona “interna real” */}
      <NavLink className="TopNavLogo" to={isAuthed ? "/" : "#"} aria-label="Ir a Home">
        <img
          src={amintLogo}
          alt="FLAV.AI"
          onError={(e) => console.error("❌ No se pudo cargar el logo", e)}
        />
      </NavLink>

      {!hideInternalNav && (
        <>
          <div className="TopNavLinks">
            <NavLink to="/" end className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}>
              Home
            </NavLink>

            {/* ✅ Admin vuelve al menú (solo visible si hay token) */}
            <NavLink to="/admin" className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}>
              Admin
            </NavLink>

            <NavLink to="/results" className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}>
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
          {/* ✅ ÚNICA ruta pública */}
          <Route path="/candidate/:token" element={<CandidatePage />} />

          {/* 🔒 TODO lo demás requiere token */}
          <Route
            path="/"
            element={
              <RequireAdminRoute>
                <HomePage />
              </RequireAdminRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <RequireAdminRoute>
                <AdminPage />
              </RequireAdminRoute>
            }
          />

          <Route
            path="/results"
            element={
              <RequireAdminRoute>
                <ResultsListPage />
              </RequireAdminRoute>
            }
          />

          <Route
            path="/results/group/:groupId"
            element={
              <RequireAdminRoute>
                <ResultsGroupPage />
              </RequireAdminRoute>
            }
          />

          <Route path="/results/demo" element={<Navigate to="/results" replace />} />

          <Route
            path="/results/:token"
            element={
              <RequireAdminRoute>
                <ResultsPage />
              </RequireAdminRoute>
            }
          />

          {/* Catch-all: cualquier otra ruta -> si no hay token, RestrictedPage (vía RequireAdminRoute) */}
          <Route
            path="*"
            element={
              <RequireAdminRoute>
                <HomePage />
              </RequireAdminRoute>
            }
          />
        </Routes>
      </main>
    </Router>
  );
};

export default App;
