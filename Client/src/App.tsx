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

const TopNav: React.FC = () => {
  const location = useLocation();

  // ✅ SOLO ocultamos links/tagline en la ruta del candidato
  const isCandidateRoute = location.pathname.startsWith("/candidate/");

  return (
    <nav className="TopNav">
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
              className={({ isActive }) =>
                `TopNavLink ${isActive ? "active" : ""}`
              }
            >
              Home
            </NavLink>

            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `TopNavLink ${isActive ? "active" : ""}`
              }
            >
              Admin
            </NavLink>

            <NavLink
              to="/results"
              className={({ isActive }) =>
                `TopNavLink ${isActive ? "active" : ""}`
              }
            >
              Results
            </NavLink>
          </div>

          <div className="TopNavTagline">
            <div className="TopNavTaglineTitle">AMINT Interview Hub</div>
            <div className="TopNavTaglineSub">
              Insight-driven interviews, powered by AI
            </div>
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
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/candidate/:token" element={<CandidatePage />} />

          {/* ✅ LISTADO */}
          <Route path="/results" element={<ResultsListPage />} />

          {/* ✅ NUEVO: DETALLE DE GRUPO */}
          <Route path="/results/group/:groupId" element={<ResultsGroupPage />} />

          {/* ✅ compatibilidad con ruta antigua (poner ANTES de :token) */}
          <Route path="/results/demo" element={<Navigate to="/results" replace />} />

          {/* ✅ DETALLE POR TOKEN */}
          <Route path="/results/:token" element={<ResultsPage />} />
        </Routes>
      </main>
    </Router>
  );
};

export default App;
