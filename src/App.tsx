// src/App.tsx
import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
} from "react-router-dom";
import "./App.css";

import HomePage from "./pages/HomePage";
import AdminPage from "./pages/AdminPage";
import CandidatePage from "./pages/CandidatePage";
import ResultsPage from "./pages/ResultsPage";

import amintLogo from "./assets/amint-logo.png"; // ✅ IMPORT REAL

const App: React.FC = () => {
  return (
    <Router>
      <nav className="TopNav">
        {/* Logo pequeño a la izquierda */}
        <NavLink className="TopNavLogo" to="/" aria-label="Ir a Home">
          <img
            src={amintLogo}
            alt="AMINT"
            onError={(e) => {
              console.error("❌ No se pudo cargar el logo", e);
            }}
          />
        </NavLink>

        {/* Links */}
        <div className="TopNavLinks">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}
          >
            Home
          </NavLink>

          <NavLink
            to="/admin"
            className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}
          >
            Admin
          </NavLink>

          <NavLink
            to="/results/demo"
            className={({ isActive }) => `TopNavLink ${isActive ? "active" : ""}`}
          >
            Results (demo)
          </NavLink>
        </div>

        {/* Tagline derecha */}
        <div className="TopNavTagline">
          <div className="TopNavTaglineTitle">AMINT Interview Hub</div>
          <div className="TopNavTaglineSub">
            Insight-driven interviews, powered by AI
          </div>
        </div>
      </nav>

      <main className="AppShell">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/candidate/:token" element={<CandidatePage />} />
          <Route path="/results/:token" element={<ResultsPage />} />
        </Routes>
      </main>
    </Router>
  );
};

export default App;
