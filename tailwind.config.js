/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/app/**/*.{js,ts,jsx,tsx}", "./src/components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0f",
        panel: "#14141e",
        accent: {
          DEFAULT: "#6c5ce7",
          2: "#a855f7",
        },
      },
    },
  },
  plugins: [],
};
