// src/pages/HomePage.tsx
import React from "react";
import { Link } from "react-router-dom";

const HomePage: React.FC = () => {
  return (
    <div className="HeyGenStreamingAvatar">
      <header className="App-header" style={{ alignItems: "flex-start" }}>
        {/* 🟥 BARRA CORPORATIVA AMINT */}
        <div className="BrandBar">
          <div className="BrandLeft">
            <div className="BrandText">
              <span className="BrandName">FLAV AI</span>
              <span className="BrandSubtitle"> - Entrevistas inteligentes</span>
            </div>
          </div>
        </div>

        <h2 style={{ marginTop: 12 }}>🏠 Panel principal (solo interno)</h2>
        <p style={{ maxWidth: 800, textAlign: "left", marginTop: 8 }}>
          Desde aquí gestionas las entrevistas y accedes a las vistas internas.
          Los candidatos nunca verán esta pantalla.
        </p>

        <ul
          style={{
            marginTop: 24,
            textAlign: "left",
            listStyle: "none",
            paddingLeft: 0,
          }}
        >
          <li style={{ marginBottom: 8 }}>
            <Link to="/admin">🔐 Ir al generador de entrevistas</Link>
          </li>
          <li style={{ marginBottom: 8 }}>
          </li>
          <li style={{ marginBottom: 8 }}>
                <Link to="/results">📊 Ver resultados</Link>
          </li>
        </ul>

        <p
          style={{
            marginTop: 24,
            fontSize: 14,
            opacity: 0.7,
            maxWidth: 800,
            textAlign: "left",
          }}
        >
          Cuando generes un link real para un candidato desde el panel de Admin,
          ellos irán directamente a <code>/candidate/&lt;token&gt;</code> sin ver
          este menú ni el panel de Admin.
        </p>
      </header>
    </div>
  );
};

export default HomePage;
