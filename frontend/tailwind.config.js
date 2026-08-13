/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        status: {
          draft: '#9ca3af',
          planning: '#3b82f6',
          awaiting_approval: '#f59e0b',
          approved: '#10b981',
          in_progress: '#6366f1',
          generating: '#8b5cf6',
          merging: '#ec4899',
          completed: '#22c55e',
          failed: '#ef4444',
          cancelled: '#6b7280',
          paused_cost: '#f97316',
          paused_rate_limit: '#eab308',
          paused_sacred_guard: '#dc2626',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
    },
  },
  plugins: [],
}