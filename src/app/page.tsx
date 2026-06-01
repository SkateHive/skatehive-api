"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";
import "./swagger-theme.css";
import TerminalShell from "./components/TerminalShell";

// Dynamically import SwaggerUI with better loading
const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
  loading: () => (
    <div className="swagger-loading">Loading API Documentation...</div>
  ),
});

// Lazy load swagger document
const getSwaggerDocument = () =>
  import("@/swagger-optimized").then((module) => module.swaggerDocument);

export default function ApiDocs() {
  const [mounted, setMounted] = useState(false);
  const [swaggerDoc, setSwaggerDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Memoize swagger configuration
  const swaggerConfig = useMemo(
    () => ({
      deepLinking: true,
      displayOperationId: false,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      docExpansion: "none" as const, // Keep sections collapsed by default
      filter: true,
      showExtensions: false,
      showCommonExtensions: false,
      tryItOutEnabled: true,
      requestInterceptor: (req: any) => {
        // Add any request modifications here
        return req;
      },
    }),
    []
  );

  useEffect(() => {
    setMounted(true);

    // Load swagger document asynchronously
    getSwaggerDocument()
      .then((doc) => {
        setSwaggerDoc(doc);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load swagger document:", err);
        setLoading(false);
      });

    // Optimize console warnings only in development
    if (process.env.NODE_ENV === "development") {
      const originalError = console.error;
      console.error = (...args) => {
        if (
          typeof args[0] === "string" &&
          (args[0].includes("UNSAFE_componentWillReceiveProps") ||
            args[0].includes("OperationContainer"))
        ) {
          return;
        }
        originalError.apply(console, args);
      };

      return () => {
        console.error = originalError;
      };
    }
  }, []);

  const status = !mounted || loading ? "loading…" : swaggerDoc ? "ready" : "error";

  return (
    <TerminalShell
      title="skatehive@api — documentation"
      command="./serve-docs --spec=openapi.json"
      active="docs"
      right={status}
    >
      <section className="t-panel">
        <div className="t-panel-head">
          <span className="t-panel-title">api_reference</span>
          <span className="t-panel-note">interactive openapi explorer</span>
        </div>
        <div className="swagger-host">
          {!mounted || loading ? (
            <div className="swagger-loading">Loading API Documentation...</div>
          ) : !swaggerDoc ? (
            <div className="swagger-loading">
              Failed to load API Documentation
            </div>
          ) : (
            <SwaggerUI spec={swaggerDoc} {...swaggerConfig} />
          )}
        </div>
      </section>

      <style jsx>{`
        .swagger-host {
          padding: 4px;
        }
      `}</style>
    </TerminalShell>
  );
}
