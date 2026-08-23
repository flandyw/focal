import { execSync } from "child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

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
  },
  plugins: [react(), tailwindcss()],

  resolve: {
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
