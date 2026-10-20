// Tailwind settings for the landing page. After changing classes in index.html, rebuild
// tailwind.css with the command in the README.
export default {
  content: { relative: true, files: ["./index.html"] },
  theme: {
    extend: {
      colors: { ink: "#0b0b0b", paper: "#f5f2e8", accent: "#ffd400" },
      fontFamily: {
        display: ["'Archivo Black'", "Impact", "system-ui", "sans-serif"],
        hand: ["Caveat", "'Comic Sans MS'", "cursive"],
      },
    },
  },
};
