import { execSync } from "child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

const examReferenceFiles = ["vcaa-grade-distributions.json", "vcaa-exam-resources.json", "vtac-scaling-reports.json", "vce-2026-timetable.json"];

const host = process.env.TAURI_DEV_HOST;

function getVersion(): string {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
  try {
    const hash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    return `v${pkg.version} (${hash})`;
  } catch {
    return `v${pkg.version} (unknown)`;
  }
}

// https://vite.dev/config/
export default defineConfig(() => ({
  define: {
    __APP_VERSION__: JSON.stringify(getVersion()),
    "import.meta.env.VITE_EMBEDDED_EXAMS": "true",
  },
  plugins: [react(), tailwindcss(), {
    name: "exam-reference-data",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split("?")[0]?.slice(1);
        if (!name || !examReferenceFiles.includes(name)) return next();
        response.setHeader("Content-Type", "application/json");
        response.end(readFileSync(path.resolve(import.meta.dirname, "web/public", name)));
      });
    },
    generateBundle() {
      for (const name of examReferenceFiles) this.emitFile({ type: "asset", fileName: name, source: readFileSync(path.resolve(import.meta.dirname, "web/public", name)) });
    },
  }],

  resolve: {
    dedupe: ["react", "react-dom", "sonner", "@supabase/supabase-js"],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },

  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "framework",
              test: /node_modules[\\/](react|react-dom|scheduler|framer-motion)[\\/]/,
              priority: 3,
            },
            {
              name: "ui",
              test: /node_modules[\\/](@radix-ui|radix-ui|lucide-react|sonner|class-variance-authority)[\\/]/,
              priority: 2,
            },
            {
              name: "tauri",
              test: /node_modules[\\/]@tauri-apps[\\/]/,
              priority: 1,
            },
            {
              name: "sync",
              test: /node_modules[\\/]@supabase[\\/]/,
            },
          ],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
