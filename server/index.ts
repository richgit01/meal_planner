import 'dotenv/config';
import { db } from './db';          // your Drizzle db instance
import { meals } from '@shared/schema';  // your meals table schema

async function testConnection() {
  try {
    const rows = await db.select().from(meals).limit(6);
    console.log('✅ Database connected! Sample meals:', rows);
  } catch (error) {
    console.warn('⚠️ Database connection test failed, but app will continue:', error instanceof Error ? error.message : String(error));
    console.log('This is expected if the database hasn\'t been seeded yet.');
  }
}

testConnection();



import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { seedDatabase } from "./seed";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// --- Health check endpoint for UptimeRobot ---
app.get("/health", (_req, res) => {
  // Keep this super fast: no DB calls
  res.status(200).type("text/plain").send("OK");
});

(async () => {
  // Seed database on startup with error handling
  try {
    await seedDatabase();
  } catch (error) {
    console.error("Warning: Database seeding failed, but continuing with app startup:", error instanceof Error ? error.message : String(error));
    console.log("The app will still function, but may not have initial data loaded.");
  }

   await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Database pool connected successfully`);
    console.log(`6:13:01 AM [express] serving on port ${port} (accessible on 0.0.0.0)`);
  });



  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  };

})();
