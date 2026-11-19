/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fence: {
          border: '#3b82f6',
          bg: 'rgba(30, 41, 59, 0.85)',
          hover: 'rgba(51, 65, 85, 0.9)',
        },
      },
    },
  },
  plugins: [],
};
